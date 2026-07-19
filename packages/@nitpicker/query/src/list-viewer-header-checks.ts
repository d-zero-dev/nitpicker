import type {
	CursorPaginatedHeaderCheckList,
	HeaderCheckEntry,
	ListViewerHeaderChecksOptions,
} from './types.js';
import type {
	HeaderChecksKeysetRow,
	HeaderChecksSortSpec,
} from './viewer-header-checks-cursor/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { readKeysetWindow } from './viewer-cursor-kit/read-keyset-window.js';
import { buildHeaderChecksFilterKey } from './viewer-header-checks-cursor/build-header-checks-filter-key.js';
import { decodeHeaderChecksCursor } from './viewer-header-checks-cursor/decode-header-checks-cursor.js';
import { encodeHeaderChecksCursor } from './viewer-header-checks-cursor/encode-header-checks-cursor.js';
import { extractHeaderChecksSortValues } from './viewer-header-checks-cursor/extract-header-checks-sort-values.js';
import { getHeaderChecksSortSpec } from './viewer-header-checks-cursor/get-header-checks-sort-spec.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';

/**
 * Applies the caller's filters — `missingOnly` (via the precomputed
 * boolean `is_missing` flag, not the `missing_count` tally — see
 * `viewer_header_checks`'s table docs for why a range predicate on
 * `missing_count` can't share an index with `ORDER BY url_sort_key`) and
 * the four individual header-presence equality filters — to a
 * `viewer_header_checks` query builder.
 * @param qb - The query builder to constrain.
 * @param options - The caller's filter options.
 */
function applyHeaderChecksFilters(
	qb: Knex.QueryBuilder,
	options: ListViewerHeaderChecksOptions,
): void {
	if (options.missingOnly) {
		qb.where('is_missing', 1);
	}
	if (options.hasCSP != null) {
		qb.where('has_csp', options.hasCSP ? 1 : 0);
	}
	if (options.hasXFrameOptions != null) {
		qb.where('has_x_frame_options', options.hasXFrameOptions ? 1 : 0);
	}
	if (options.hasXContentTypeOptions != null) {
		qb.where('has_x_content_type_options', options.hasXContentTypeOptions ? 1 : 0);
	}
	if (options.hasHSTS != null) {
		qb.where('has_hsts', options.hasHSTS ? 1 : 0);
	}
}

/**
 * Counts the total `viewer_header_checks` rows matching the caller's filters.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter options.
 * @returns The total matching row count.
 */
async function countHeaderChecksTotal(
	knex: Knex,
	options: ListViewerHeaderChecksOptions,
): Promise<number> {
	const qb = knex('viewer_header_checks');
	applyHeaderChecksFilters(qb, options);
	const result = await qb.count<{ count: string }[]>({ count: '*' });
	return Number(result[0]?.count ?? 0);
}

/**
 * Runs one `viewer_header_checks` read via the shared {@link readKeysetWindow}.
 * Unlike `list-viewer-images.ts`'s id-then-join step, no join follows:
 * `url_sort_key` is already the exact display URL (copied from `pages.url`
 * verbatim at build time — see `viewer_header_checks`'s table docs), so this
 * window read IS the final row set, the same no-join shape
 * `listViewerBrokenLinks` uses for `viewer_anchor_facts`.
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
async function readHeaderChecksWindow(
	knex: Knex,
	options: ListViewerHeaderChecksOptions,
	spec: HeaderChecksSortSpec,
	orderDirection: 'asc' | 'desc',
	limit: number,
	keyset: { operator: '>' | '<'; values: readonly (string | number)[] } | undefined,
	offset: number,
): Promise<
	(HeaderChecksKeysetRow & {
		has_csp: number;
		has_x_frame_options: number;
		has_x_content_type_options: number;
		has_hsts: number;
	})[]
> {
	return readKeysetWindow(
		knex,
		'viewer_header_checks',
		(qb) => applyHeaderChecksFilters(qb, options),
		[
			'page_id',
			'url_sort_key',
			'has_csp',
			'has_x_frame_options',
			'has_x_content_type_options',
			'has_hsts',
		],
		spec,
		orderDirection,
		limit,
		keyset,
		offset,
	);
}

/**
 * Maps one raw window row to the public `HeaderCheckEntry` shape.
 * @param row - One row from {@link readHeaderChecksWindow}.
 * @param row.url_sort_key
 * @param row.has_csp
 * @param row.has_x_frame_options
 * @param row.has_x_content_type_options
 * @param row.has_hsts
 * @returns The corresponding `HeaderCheckEntry`.
 */
function toHeaderCheckEntry(row: {
	url_sort_key: string;
	has_csp: number;
	has_x_frame_options: number;
	has_x_content_type_options: number;
	has_hsts: number;
}): HeaderCheckEntry {
	return {
		url: row.url_sort_key,
		hasCSP: !!row.has_csp,
		hasXFrameOptions: !!row.has_x_frame_options,
		hasXContentTypeOptions: !!row.has_x_content_type_options,
		hasHSTS: !!row.has_hsts,
	};
}

/**
 * Lists security-header checks from `viewer_header_checks` — the
 * read-model-backed, cursor-paginated counterpart of `checkHeaders` that
 * powers `/api/headers`'s fast path (issue #119).
 *
 * Filter/sort resolution runs entirely against the narrow, indexed
 * `viewer_header_checks` table; the `pages.responseHeaders` JSON blob is
 * never read here (it was already reduced to four booleans and a
 * `missing_count` tally at read-model build time — see
 * `computeHeaderCheckInsertRows`).
 *
 * The initial read (no `cursor`), the forward keyset read, the backward
 * keyset read, and the direct-`offset` read are four separate code paths,
 * mirroring `listViewerBrokenLinks`/`listViewerPages`.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this.
 * @param options - Filter, sort, and pagination options.
 * @returns A cursor-paginated list of header-check entries.
 * @throws {Error} If `options.cursor` is malformed, stale, or was minted
 *   under a different filter/sort combination.
 * @example
 * const page1 = await listViewerHeaderChecks(accessor, { limit: 100 });
 * const page2 = page1.nextCursor
 *   ? await listViewerHeaderChecks(accessor, { limit: 100, cursor: page1.nextCursor })
 *   : null;
 */
export async function listViewerHeaderChecks(
	accessor: ArchiveAccessor,
	options: ListViewerHeaderChecksOptions = {},
): Promise<CursorPaginatedHeaderCheckList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const sortOrder = options.sortOrder ?? 'asc';
	const spec = getHeaderChecksSortSpec(sortOrder);
	const filterKey = buildHeaderChecksFilterKey(options);

	const total = await countHeaderChecksTotal(knex, options);

	/**
	 * Builds the final result from a `limit`-or-fewer window, already in
	 * final display order.
	 * @param window - The trimmed row window.
	 * @param hasMoreAfter - Whether a subsequent page exists.
	 * @param hasMoreBefore - Whether a preceding page exists.
	 * @returns The full paginated result.
	 */
	function buildResult(
		window: Awaited<ReturnType<typeof readHeaderChecksWindow>>,
		hasMoreAfter: boolean,
		hasMoreBefore: boolean,
	): CursorPaginatedHeaderCheckList {
		const items = window.map((row) => toHeaderCheckEntry(row));
		const lastRow = window.at(-1);
		const firstRow = window[0];
		const nextCursor =
			hasMoreAfter && lastRow
				? encodeHeaderChecksCursor({
						v: VIEWER_READ_MODEL_SCHEMA_VERSION,
						filterKey,
						sortBy: 'url',
						sortOrder,
						values: extractHeaderChecksSortValues(spec, lastRow),
					})
				: null;
		const prevCursor =
			hasMoreBefore && firstRow
				? encodeHeaderChecksCursor({
						v: VIEWER_READ_MODEL_SCHEMA_VERSION,
						filterKey,
						sortBy: 'url',
						sortOrder,
						values: extractHeaderChecksSortValues(spec, firstRow),
					})
				: null;
		return { items, total, offset: options.offset ?? 0, limit, nextCursor, prevCursor };
	}

	if (options.cursor) {
		const decoded = decodeHeaderChecksCursor(options.cursor, { filterKey, sortOrder });
		if (options.direction === 'prev') {
			const oppositeDirection = spec.scanDirection === 'asc' ? 'desc' : 'asc';
			const fetched = await readHeaderChecksWindow(
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
		const fetched = await readHeaderChecksWindow(
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
	const fetched = await readHeaderChecksWindow(
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
