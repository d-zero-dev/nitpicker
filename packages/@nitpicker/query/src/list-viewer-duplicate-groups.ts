import type {
	CursorPaginatedDuplicateGroupList,
	ListViewerDuplicateGroupsOptions,
	ViewerDuplicateGroupEntry,
} from './types.js';
import type {
	DuplicateGroupsKeysetRow,
	DuplicateGroupsSortSpec,
} from './viewer-duplicate-groups-cursor/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { readKeysetWindow } from './viewer-cursor-kit/read-keyset-window.js';
import { buildDuplicateGroupsFilterKey } from './viewer-duplicate-groups-cursor/build-duplicate-groups-filter-key.js';
import { decodeDuplicateGroupsCursor } from './viewer-duplicate-groups-cursor/decode-duplicate-groups-cursor.js';
import { encodeDuplicateGroupsCursor } from './viewer-duplicate-groups-cursor/encode-duplicate-groups-cursor.js';
import { extractDuplicateGroupsSortValues } from './viewer-duplicate-groups-cursor/extract-duplicate-groups-sort-values.js';
import { getDuplicateGroupsSortSpec } from './viewer-duplicate-groups-cursor/get-duplicate-groups-sort-spec.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';

/** Default inline page-URL sample size per group — see `ListViewerDuplicateGroupsOptions.pagesLimit`. */
const DEFAULT_PAGES_LIMIT = 20;

/** One `viewer_duplicate_groups` window row, plus its display-only columns. */
interface DuplicateGroupWindowRow extends DuplicateGroupsKeysetRow {
	/** See `viewer_duplicate_groups.field`. */
	field: 'title' | 'description';
	/** See `viewer_duplicate_groups.value`. */
	value: string;
	/** See `viewer_duplicate_groups.count`. */
	count: number;
}

/**
 * Applies the caller's `field` filter — the only filter
 * `listViewerDuplicateGroups` supports, and required (see
 * `ListViewerDuplicateGroupsOptions.field`'s docs) — to a
 * `viewer_duplicate_groups` query builder.
 * @param qb - The query builder to constrain.
 * @param options - The caller's filter options.
 */
function applyDuplicateGroupsFilters(
	qb: Knex.QueryBuilder,
	options: ListViewerDuplicateGroupsOptions,
): void {
	qb.where('field', options.field);
}

/**
 * Counts the total `viewer_duplicate_groups` rows matching the caller's `field`.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter options.
 * @returns The total matching row count.
 */
async function countViewerDuplicateGroupsTotal(
	knex: Knex,
	options: ListViewerDuplicateGroupsOptions,
): Promise<number> {
	const qb = knex('viewer_duplicate_groups');
	applyDuplicateGroupsFilters(qb, options);
	const result = await qb.count<{ count: string }[]>({ count: '*' });
	return Number(result[0]?.count ?? 0);
}

/**
 * Runs one `viewer_duplicate_groups` read via the shared
 * {@link readKeysetWindow}.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter options.
 * @param spec - The resolved sort spec (columns to select/order by).
 * @param orderDirection - The physical scan direction for this read.
 * @param limit - The page size (the read fetches `limit + 1` rows).
 * @param keyset - The keyset predicate to apply, or `undefined` for an
 *   unconstrained (initial / offset) read.
 * @param offset - Row offset for a direct `OFFSET` read (page-number jumps).
 *   Ignored when `keyset` is supplied.
 * @returns Up to `limit + 1` rows.
 */
async function readDuplicateGroupsWindow(
	knex: Knex,
	options: ListViewerDuplicateGroupsOptions,
	spec: DuplicateGroupsSortSpec,
	orderDirection: 'asc' | 'desc',
	limit: number,
	keyset: { operator: '>' | '<'; values: readonly (string | number)[] } | undefined,
	offset: number,
): Promise<DuplicateGroupWindowRow[]> {
	return readKeysetWindow(
		knex,
		'viewer_duplicate_groups',
		(qb) => applyDuplicateGroupsFilters(qb, options),
		['field', 'value', 'count'],
		spec,
		orderDirection,
		limit,
		keyset,
		offset,
	);
}

/**
 * Fetches an inline head sample (at most `pagesLimit` URLs each, in
 * `url_sort_key` order) of every listed group's member pages in a single
 * query, keyed by `group_id` — avoids the N+1 that a naive per-group
 * `SELECT ... WHERE group_id = ? LIMIT pagesLimit` loop would cost for a
 * `limit`-sized (e.g. 100) page of groups.
 *
 * A window function (`ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY
 * url_sort_key, page_id)`) is required rather than a single flat `LIMIT`
 * across every candidate row: a flat `LIMIT groupIds.length * pagesLimit`
 * would let one large group's member rows crowd out a later group's rows
 * once the earlier group's true membership exceeds its "fair share" of the
 * budget, silently starving later groups of their own `pagesLimit` sample —
 * partitioning per `group_id` is the only way to guarantee every group gets
 * up to `pagesLimit` rows regardless of its neighbors' sizes.
 * @param knex - The archive's Knex instance.
 * @param groupIds - The `group_id`s to fetch member-page samples for.
 * @param pagesLimit - Maximum member-page URLs to keep per group.
 * @returns A `group_id` → ordered URL list map. Groups with no member rows
 *   (should not happen for a real duplicate group, but handled defensively)
 *   are simply absent from the map.
 */
async function fetchDuplicateGroupPageSamples(
	knex: Knex,
	groupIds: readonly number[],
	pagesLimit: number,
): Promise<Map<number, string[]>> {
	const samples = new Map<number, string[]>();
	if (groupIds.length === 0) {
		return samples;
	}

	const placeholders = groupIds.map(() => '?').join(', ');
	const rows: { group_id: number; url_sort_key: string }[] = await knex.raw(
		`SELECT group_id, url_sort_key FROM (
			SELECT group_id, url_sort_key,
				ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY url_sort_key, page_id) AS rn
			FROM viewer_duplicate_group_pages
			WHERE group_id IN (${placeholders})
		) WHERE rn <= ?
		ORDER BY group_id, url_sort_key`,
		[...groupIds, pagesLimit],
	);

	for (const row of rows) {
		const urls = samples.get(row.group_id);
		if (urls) {
			urls.push(row.url_sort_key);
		} else {
			samples.set(row.group_id, [row.url_sort_key]);
		}
	}
	return samples;
}

/**
 * Builds the final {@link CursorPaginatedDuplicateGroupList}: fetches an
 * inline page-URL sample for the window's groups in one batched query, and
 * mints `nextCursor`/`prevCursor` from the window's boundary rows.
 * @param knex - The archive's Knex instance.
 * @param window - Up to `limit` rows from {@link readDuplicateGroupsWindow},
 *   already in FINAL display order.
 * @param context - Shared cursor/response context.
 * @param context.pagesLimit - The effective inline page-sample size.
 * @param context.filterKey - See `buildDuplicateGroupsFilterKey`.
 * @param context.total - The total matching row count.
 * @param context.limit - The effective page size.
 * @param context.offset - The effective `offset` to echo in the response.
 * @param context.hasMoreAfter - Whether a subsequent page exists.
 * @param context.hasMoreBefore - Whether a preceding page exists.
 * @returns The full paginated result.
 */
async function buildResult(
	knex: Knex,
	window: DuplicateGroupWindowRow[],
	context: {
		pagesLimit: number;
		filterKey: string;
		total: number;
		limit: number;
		offset: number;
		hasMoreAfter: boolean;
		hasMoreBefore: boolean;
	},
): Promise<CursorPaginatedDuplicateGroupList> {
	const { pagesLimit, filterKey, total, limit, offset, hasMoreAfter, hasMoreBefore } =
		context;
	const spec = getDuplicateGroupsSortSpec();
	const samples = await fetchDuplicateGroupPageSamples(
		knex,
		window.map((row) => row.group_id),
		pagesLimit,
	);
	const items: ViewerDuplicateGroupEntry[] = window.map((row) => ({
		groupId: row.group_id,
		field: row.field,
		value: row.value,
		count: Number(row.count),
		pages: samples.get(row.group_id) ?? [],
	}));

	const lastRow = window.at(-1);
	const firstRow = window[0];
	const nextCursor =
		hasMoreAfter && lastRow
			? encodeDuplicateGroupsCursor({
					v: VIEWER_READ_MODEL_SCHEMA_VERSION,
					filterKey,
					sortBy: 'count',
					sortOrder: 'asc',
					values: extractDuplicateGroupsSortValues(spec, lastRow),
				})
			: null;
	const prevCursor =
		hasMoreBefore && firstRow
			? encodeDuplicateGroupsCursor({
					v: VIEWER_READ_MODEL_SCHEMA_VERSION,
					filterKey,
					sortBy: 'count',
					sortOrder: 'asc',
					values: extractDuplicateGroupsSortValues(spec, firstRow),
				})
			: null;
	return { items, total, offset, limit, nextCursor, prevCursor };
}

/**
 * Lists duplicate-metadata groups from `viewer_duplicate_groups` — the
 * read-model-backed, cursor-paginated counterpart of `findDuplicates` that
 * powers `/api/duplicates`'s fast path (issue #115).
 *
 * Groups are always most-duplicated-first (`count` descending, via the
 * `count_desc_key` keyset column). Each group's `pages` field is an inline
 * head sample fetched from `viewer_duplicate_group_pages` in one batched
 * query per page of groups (see `fetchDuplicateGroupPageSamples`) — full
 * pagination through a single group's complete member-page list goes through
 * `listViewerDuplicateGroupPages` instead.
 *
 * The initial read (no `cursor`), the forward keyset read, the backward
 * keyset read, and the direct-`offset` read are four separate code paths,
 * mirroring `listViewerHeaderChecks`/`listViewerBrokenLinks`.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this.
 * @param options - Filter and pagination options. `field` is required.
 * @returns A cursor-paginated list of duplicate-group entries.
 * @throws {Error} If `options.cursor` is malformed, stale, or was minted
 *   under a different `field`.
 * @example
 * const page1 = await listViewerDuplicateGroups(accessor, { field: 'title' });
 * const page2 = page1.nextCursor
 *   ? await listViewerDuplicateGroups(accessor, { field: 'title', cursor: page1.nextCursor })
 *   : null;
 */
export async function listViewerDuplicateGroups(
	accessor: ArchiveAccessor,
	options: ListViewerDuplicateGroupsOptions,
): Promise<CursorPaginatedDuplicateGroupList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const pagesLimit = options.pagesLimit ?? DEFAULT_PAGES_LIMIT;
	const spec = getDuplicateGroupsSortSpec();
	const filterKey = buildDuplicateGroupsFilterKey(options);

	const total = await countViewerDuplicateGroupsTotal(knex, options);

	if (options.cursor) {
		const decoded = decodeDuplicateGroupsCursor(options.cursor, { filterKey });
		if (options.direction === 'prev') {
			const oppositeDirection = spec.scanDirection === 'asc' ? 'desc' : 'asc';
			const fetched = await readDuplicateGroupsWindow(
				knex,
				options,
				spec,
				oppositeDirection,
				limit,
				{ operator: spec.scanDirection === 'asc' ? '<' : '>', values: decoded.values },
				0,
			);
			const hasMoreBefore = fetched.length > limit;
			const window = fetched.slice(0, limit).toReversed();
			return buildResult(knex, window, {
				pagesLimit,
				filterKey,
				total,
				limit,
				offset: options.offset ?? 0,
				hasMoreAfter: true,
				hasMoreBefore,
			});
		}
		const fetched = await readDuplicateGroupsWindow(
			knex,
			options,
			spec,
			spec.scanDirection,
			limit,
			{ operator: spec.scanDirection === 'asc' ? '>' : '<', values: decoded.values },
			0,
		);
		const hasMoreAfter = fetched.length > limit;
		const window = fetched.slice(0, limit);
		return buildResult(knex, window, {
			pagesLimit,
			filterKey,
			total,
			limit,
			offset: options.offset ?? 0,
			hasMoreAfter,
			hasMoreBefore: true,
		});
	}

	const offset = options.offset ?? 0;
	const fetched = await readDuplicateGroupsWindow(
		knex,
		options,
		spec,
		spec.scanDirection,
		limit,
		undefined,
		offset,
	);
	const hasMoreAfter = fetched.length > limit;
	const window = fetched.slice(0, limit);
	return buildResult(knex, window, {
		pagesLimit,
		filterKey,
		total,
		limit,
		offset,
		hasMoreAfter,
		hasMoreBefore: offset > 0,
	});
}
