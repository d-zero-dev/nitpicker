import type {
	CursorPaginatedLinkList,
	LinkEntry,
	ListViewerBrokenLinksOptions,
} from './types.js';
import type {
	AnchorFactsKeysetRow,
	AnchorFactsSortSpec,
} from './viewer-anchor-facts-cursor/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { buildAnchorFactsFilterKey } from './viewer-anchor-facts-cursor/build-anchor-facts-filter-key.js';
import { decodeAnchorFactsCursor } from './viewer-anchor-facts-cursor/decode-anchor-facts-cursor.js';
import { encodeAnchorFactsCursor } from './viewer-anchor-facts-cursor/encode-anchor-facts-cursor.js';
import { extractAnchorFactsSortValues } from './viewer-anchor-facts-cursor/extract-anchor-facts-sort-values.js';
import { getAnchorFactsSortSpec } from './viewer-anchor-facts-cursor/get-anchor-facts-sort-spec.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';

/**
 * Adds a keyset comparison tuple as a `WHERE` predicate — `(col1, col2, …)
 * {>|<} (?, ?, …)` — using SQLite's row-value comparison. Column names come
 * from the fixed {@link AnchorFactsSortSpec} column set, never from request
 * input, so interpolating them into the SQL text (rather than parameter
 * binding, which only covers values) carries no injection risk. Mirrors
 * `list-viewer-pages.ts`'s identical helper — not shared as a common module
 * since the two existing keyset-cursor implementations in this package have
 * never been generalised into one, matching `list-directory-pages.ts`'s
 * independent, table-specific cursor scheme.
 * @param qb - The query builder to constrain.
 * @param columns - The keyset tuple columns, in comparison order.
 * @param operator - `'>'` for a forward (ascending-tuple) seek, `'<'` for a
 *   backward one.
 * @param values - The boundary row's tuple values, in `columns` order.
 */
function applyKeysetPredicate(
	qb: Knex.QueryBuilder,
	columns: readonly string[],
	operator: '>' | '<',
	values: readonly (string | number)[],
): void {
	const columnList = columns.join(', ');
	const placeholders = columns.map(() => '?').join(', ');
	qb.whereRaw(`(${columnList}) ${operator} (${placeholders})`, [...values]);
}

/**
 * Applies the (currently sole) filter — `status` — on top of the fixed
 * `is_broken = 1` predicate every read shares.
 * @param qb - The query builder to constrain.
 * @param options - The caller's filter options.
 */
function applyBrokenLinksFilters(
	qb: Knex.QueryBuilder,
	options: ListViewerBrokenLinksOptions,
): void {
	qb.where('is_broken', 1);
	if (options.status != null) {
		qb.where('status', options.status);
	}
}

/**
 * Counts the total `is_broken = 1` rows matching the caller's filters.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter options.
 * @returns The total matching row count.
 */
async function countAnchorFactsTotal(
	knex: Knex,
	options: ListViewerBrokenLinksOptions,
): Promise<number> {
	const qb = knex('viewer_anchor_facts');
	applyBrokenLinksFilters(qb, options);
	const result = await qb.count<{ count: string }[]>({ count: '*' });
	return Number(result[0]?.count ?? 0);
}

/**
 * Runs one `viewer_anchor_facts` read: applies filters, an optional keyset
 * predicate, an `ORDER BY` in `orderDirection`, and `limit + 1` rows (the
 * `+1` lets the caller detect "is there another row past this page"
 * without a second query). Unlike `list-viewer-pages.ts`'s equivalent, no
 * id-then-join step follows: `source_url_sort_key`/`dest_url_sort_key`/
 * `status` are already the exact display values, so this window read IS
 * the final row set.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter options.
 * @param spec - The resolved sort spec (columns to select/order by).
 * @param orderDirection - The physical scan direction for this read.
 * @param limit - The page size (the read fetches `limit + 1` rows).
 * @param keyset - The keyset predicate to apply, or `undefined` for an
 *   unconstrained (initial / offset) read.
 * @param keyset.operator - `'>'` or `'<'`, per {@link applyKeysetPredicate}.
 * @param keyset.values - The boundary row's tuple values.
 * @param offset - Row offset for a direct `OFFSET` read (page-number jumps).
 *   Ignored when `keyset` is supplied.
 * @returns Up to `limit + 1` rows.
 */
async function readAnchorFactsWindow(
	knex: Knex,
	options: ListViewerBrokenLinksOptions,
	spec: AnchorFactsSortSpec,
	orderDirection: 'asc' | 'desc',
	limit: number,
	keyset: { operator: '>' | '<'; values: readonly (string | number)[] } | undefined,
	offset: number,
): Promise<
	(AnchorFactsKeysetRow & {
		source_url_sort_key: string;
		dest_url_sort_key: string;
		status: number | null;
		is_external_link: number;
	})[]
> {
	const qb = knex('viewer_anchor_facts');
	applyBrokenLinksFilters(qb, options);
	if (keyset) {
		applyKeysetPredicate(qb, spec.columns, keyset.operator, keyset.values);
	}
	const selectColumns = [
		...new Set<string>([
			'edge_id',
			'source_url_sort_key',
			'dest_url_sort_key',
			'status',
			'status_sort_key',
			'status_desc_key',
			'is_external_link',
			...spec.columns,
		]),
	];
	let query = qb
		.select(selectColumns)
		.orderBy(spec.columns.map((column) => ({ column, order: orderDirection })))
		.limit(limit + 1);
	if (!keyset && offset > 0) {
		query = query.offset(offset);
	}
	return query;
}

/**
 * Maps one raw window row to the public {@link LinkEntry} shape.
 * `textContent` is always `null`: `viewer_anchor_facts` doesn't store per-
 * anchor text (broken-links-view.tsx never renders it, and storing it would
 * duplicate potentially large strings across every edge row — see
 * ARCHITECTURE.md「設計注意（viewer_anchor_facts read model、issue
 * #114）」). `isExternal` reflects the edge's `is_external_link` flag —
 * broken and external are independent judgments, so a broken link CAN also
 * be external.
 * @param row - One row from {@link readAnchorFactsWindow}.
 * @param row.source_url_sort_key
 * @param row.dest_url_sort_key
 * @param row.status
 * @param row.is_external_link
 * @returns The corresponding {@link LinkEntry}.
 */
function toLinkEntry(row: {
	source_url_sort_key: string;
	dest_url_sort_key: string;
	status: number | null;
	is_external_link?: number;
}): LinkEntry {
	return {
		sourceUrl: row.source_url_sort_key,
		destUrl: row.dest_url_sort_key,
		status: row.status,
		isExternal: !!row.is_external_link,
		textContent: null,
	};
}

/**
 * Lists broken links from `viewer_anchor_facts` — the read-model-backed,
 * cursor-paginated counterpart of `listLinks(accessor, { type: 'broken' })`
 * that powers `/api/links?type=broken`'s fast path.
 *
 * Filter/sort resolution runs entirely against `viewer_anchor_facts`; there
 * is no id-then-join step (unlike `listViewerPages`) because
 * `source_url_sort_key`/`dest_url_sort_key`/`status` are already the exact
 * display values — see that table's `create-viewer-read-model-tables.ts`
 * docs for why this doesn't reintroduce the URL-duplication cost issue
 * #114 warns about at 13M-edge scale (negligible at this package's actual
 * benchmark scale; see ARCHITECTURE.md).
 *
 * The initial read (no `cursor`), the forward keyset read, the backward
 * keyset read, and the direct-`offset` read are four separate code paths —
 * no `(:cursor IS NULL OR …)`-style nullable predicate ties them together,
 * mirroring `listViewerPages`.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) AND that `urlPattern` is not set (see
 *   `ListViewerBrokenLinksOptions`'s docs) before calling this.
 * @param options - Filter, sort, and pagination options.
 * @returns A cursor-paginated list of broken-link entries.
 * @throws {Error} If `options.cursor` is malformed, stale, or was minted
 *   under a different filter/sort combination.
 * @example
 * // Virtual-scroll continuation — the caller only ever inspects nextCursor:
 * const page1 = await listViewerBrokenLinks(accessor, { limit: 100 });
 * const page2 = page1.nextCursor
 *   ? await listViewerBrokenLinks(accessor, { limit: 100, cursor: page1.nextCursor })
 *   : null;
 */
export async function listViewerBrokenLinks(
	accessor: ArchiveAccessor,
	options: ListViewerBrokenLinksOptions = {},
): Promise<CursorPaginatedLinkList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const sortBy = options.sortBy ?? 'sourceUrl';
	const sortOrder = options.sortOrder ?? 'asc';
	const spec = getAnchorFactsSortSpec(sortBy, sortOrder);
	const filterKey = buildAnchorFactsFilterKey(options);

	const total = await countAnchorFactsTotal(knex, options);

	/**
	 * Builds the final result from a `limit`-or-fewer window, already in
	 * final display order.
	 * @param window - The trimmed row window.
	 * @param hasMoreAfter - Whether a subsequent page exists.
	 * @param hasMoreBefore - Whether a preceding page exists.
	 * @returns The full paginated result.
	 */
	function buildResult(
		window: Awaited<ReturnType<typeof readAnchorFactsWindow>>,
		hasMoreAfter: boolean,
		hasMoreBefore: boolean,
	): CursorPaginatedLinkList {
		const items = window.map((row) => toLinkEntry(row));
		const lastRow = window.at(-1);
		const firstRow = window[0];
		const nextCursor =
			hasMoreAfter && lastRow
				? encodeAnchorFactsCursor({
						v: VIEWER_READ_MODEL_SCHEMA_VERSION,
						filterKey,
						sortBy,
						sortOrder,
						values: extractAnchorFactsSortValues(spec, lastRow),
					})
				: null;
		const prevCursor =
			hasMoreBefore && firstRow
				? encodeAnchorFactsCursor({
						v: VIEWER_READ_MODEL_SCHEMA_VERSION,
						filterKey,
						sortBy,
						sortOrder,
						values: extractAnchorFactsSortValues(spec, firstRow),
					})
				: null;
		return { items, total, nextCursor, prevCursor };
	}

	if (options.cursor) {
		const decoded = decodeAnchorFactsCursor(options.cursor, {
			filterKey,
			sortBy,
			sortOrder,
			columns: spec.columns,
		});
		if (options.direction === 'prev') {
			const oppositeDirection = spec.scanDirection === 'asc' ? 'desc' : 'asc';
			const fetched = await readAnchorFactsWindow(
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
		const fetched = await readAnchorFactsWindow(
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
	const fetched = await readAnchorFactsWindow(
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
