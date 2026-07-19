import type {
	CursorPaginatedDuplicateGroupPageList,
	ListViewerDuplicateGroupPagesOptions,
} from './types.js';
import type {
	DuplicateGroupPagesKeysetRow,
	DuplicateGroupPagesSortSpec,
} from './viewer-duplicate-group-pages-cursor/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { readKeysetWindow } from './viewer-cursor-kit/read-keyset-window.js';
import { buildDuplicateGroupPagesFilterKey } from './viewer-duplicate-group-pages-cursor/build-duplicate-group-pages-filter-key.js';
import { decodeDuplicateGroupPagesCursor } from './viewer-duplicate-group-pages-cursor/decode-duplicate-group-pages-cursor.js';
import { encodeDuplicateGroupPagesCursor } from './viewer-duplicate-group-pages-cursor/encode-duplicate-group-pages-cursor.js';
import { extractDuplicateGroupPagesSortValues } from './viewer-duplicate-group-pages-cursor/extract-duplicate-group-pages-sort-values.js';
import { getDuplicateGroupPagesSortSpec } from './viewer-duplicate-group-pages-cursor/get-duplicate-group-pages-sort-spec.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';

/**
 * Constrains a `viewer_duplicate_group_pages` query builder to one group's
 * member rows — the only filter `listViewerDuplicateGroupPages` supports.
 * @param qb - The query builder to constrain.
 * @param options - The caller's options.
 */
function applyDuplicateGroupPagesFilters(
	qb: Knex.QueryBuilder,
	options: ListViewerDuplicateGroupPagesOptions,
): void {
	qb.where('group_id', options.groupId);
}

/**
 * Counts the total `viewer_duplicate_group_pages` rows for one group.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's options.
 * @returns The total member-page count for `options.groupId`.
 */
async function countViewerDuplicateGroupPagesTotal(
	knex: Knex,
	options: ListViewerDuplicateGroupPagesOptions,
): Promise<number> {
	const qb = knex('viewer_duplicate_group_pages');
	applyDuplicateGroupPagesFilters(qb, options);
	const result = await qb.count<{ count: string }[]>({ count: '*' });
	return Number(result[0]?.count ?? 0);
}

/**
 * Runs one `viewer_duplicate_group_pages` read via the shared
 * {@link readKeysetWindow}. No join follows: `url_sort_key` is already the
 * exact display URL (copied from `pages.url` verbatim at build time), the
 * same no-join shape `listViewerHeaderChecks`/`listViewerBrokenLinks` use.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's options.
 * @param spec - The resolved sort spec (columns to select/order by).
 * @param orderDirection - The physical scan direction for this read.
 * @param limit - The page size (the read fetches `limit + 1` rows).
 * @param keyset - The keyset predicate to apply, or `undefined` for an
 *   unconstrained (initial / offset) read.
 * @param offset - Row offset for a direct `OFFSET` read (page-number jumps).
 *   Ignored when `keyset` is supplied.
 * @returns Up to `limit + 1` rows.
 */
async function readDuplicateGroupPagesWindow(
	knex: Knex,
	options: ListViewerDuplicateGroupPagesOptions,
	spec: DuplicateGroupPagesSortSpec,
	orderDirection: 'asc' | 'desc',
	limit: number,
	keyset: { operator: '>' | '<'; values: readonly (string | number)[] } | undefined,
	offset: number,
): Promise<DuplicateGroupPagesKeysetRow[]> {
	return readKeysetWindow(
		knex,
		'viewer_duplicate_group_pages',
		(qb) => applyDuplicateGroupPagesFilters(qb, options),
		['page_id', 'url_sort_key'],
		spec,
		orderDirection,
		limit,
		keyset,
		offset,
	);
}

/**
 * Lists one duplicate group's COMPLETE member-page URL set from
 * `viewer_duplicate_group_pages` — the read-model-backed, cursor-paginated
 * counterpart `listViewerDuplicateGroups`'s inline `pages` sample defers to
 * once `count > pages.length` (issue #115).
 *
 * The initial read (no `cursor`), the forward keyset read, the backward
 * keyset read, and the direct-`offset` read are four separate code paths,
 * mirroring `listViewerHeaderChecks`/`listViewerBrokenLinks`.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this.
 * @param options - Pagination options. `groupId` is required.
 * @returns A cursor-paginated list of member-page URLs, `url_sort_key` order.
 * @throws {Error} If `options.cursor` is malformed, stale, or was minted
 *   under a different `groupId`.
 * @example
 * const page1 = await listViewerDuplicateGroupPages(accessor, { groupId: 3 });
 * const page2 = page1.nextCursor
 *   ? await listViewerDuplicateGroupPages(accessor, { groupId: 3, cursor: page1.nextCursor })
 *   : null;
 */
export async function listViewerDuplicateGroupPages(
	accessor: ArchiveAccessor,
	options: ListViewerDuplicateGroupPagesOptions,
): Promise<CursorPaginatedDuplicateGroupPageList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const spec = getDuplicateGroupPagesSortSpec();
	const filterKey = buildDuplicateGroupPagesFilterKey(options);

	const total = await countViewerDuplicateGroupPagesTotal(knex, options);

	/**
	 * Builds the final result from a `limit`-or-fewer window, already in
	 * final display order.
	 * @param window - The trimmed row window.
	 * @param hasMoreAfter - Whether a subsequent page exists.
	 * @param hasMoreBefore - Whether a preceding page exists.
	 * @returns The full paginated result.
	 */
	function buildResult(
		window: DuplicateGroupPagesKeysetRow[],
		hasMoreAfter: boolean,
		hasMoreBefore: boolean,
	): CursorPaginatedDuplicateGroupPageList {
		const items = window.map((row) => row.url_sort_key);
		const lastRow = window.at(-1);
		const firstRow = window[0];
		const nextCursor =
			hasMoreAfter && lastRow
				? encodeDuplicateGroupPagesCursor({
						v: VIEWER_READ_MODEL_SCHEMA_VERSION,
						filterKey,
						sortBy: 'url',
						sortOrder: 'asc',
						values: extractDuplicateGroupPagesSortValues(spec, lastRow),
					})
				: null;
		const prevCursor =
			hasMoreBefore && firstRow
				? encodeDuplicateGroupPagesCursor({
						v: VIEWER_READ_MODEL_SCHEMA_VERSION,
						filterKey,
						sortBy: 'url',
						sortOrder: 'asc',
						values: extractDuplicateGroupPagesSortValues(spec, firstRow),
					})
				: null;
		return { items, total, offset: options.offset ?? 0, limit, nextCursor, prevCursor };
	}

	if (options.cursor) {
		const decoded = decodeDuplicateGroupPagesCursor(options.cursor, { filterKey });
		if (options.direction === 'prev') {
			const oppositeDirection = spec.scanDirection === 'asc' ? 'desc' : 'asc';
			const fetched = await readDuplicateGroupPagesWindow(
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
			return buildResult(window, true, hasMoreBefore);
		}
		const fetched = await readDuplicateGroupPagesWindow(
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
		return buildResult(window, hasMoreAfter, true);
	}

	const offset = options.offset ?? 0;
	const fetched = await readDuplicateGroupPagesWindow(
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
	return buildResult(window, hasMoreAfter, offset > 0);
}
