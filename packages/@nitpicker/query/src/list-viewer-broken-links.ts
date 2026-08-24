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

import { applyEqualityOrInFilter } from './apply-equality-or-in-filter.js';
import { buildAnchorFactsFilterKey } from './viewer-anchor-facts-cursor/build-anchor-facts-filter-key.js';
import { decodeAnchorFactsCursor } from './viewer-anchor-facts-cursor/decode-anchor-facts-cursor.js';
import { encodeAnchorFactsCursor } from './viewer-anchor-facts-cursor/encode-anchor-facts-cursor.js';
import { extractAnchorFactsSortValues } from './viewer-anchor-facts-cursor/extract-anchor-facts-sort-values.js';
import { getAnchorFactsSortSpec } from './viewer-anchor-facts-cursor/get-anchor-facts-sort-spec.js';
import { readKeysetWindow } from './viewer-cursor-kit/read-keyset-window.js';
import { resolveViewerUrlRefs } from './viewer-cursor-kit/resolve-viewer-url-refs.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';

/**
 * Applies the caller's filters — `status` and `urlPattern` — on top of the
 * fixed `is_broken = 1` predicate every read shares.
 *
 * `urlPattern` joins `viewer_url_refs` twice (source and dest aliases) and
 * ORs a LIKE across both. INNER joins are safe: every `viewer_anchor_facts`
 * row carries non-null `source_url_ref_id`/`dest_url_ref_id` referencing
 * `viewer_url_refs(id)`, so no rows are dropped, and both joins are 1:1 so
 * `countAnchorFactsTotal`'s `COUNT(*)` over the same builder stays correct.
 * The join aliases' columns (`id`/`url`) don't collide with any of the bare
 * column names `readKeysetWindow` selects from `viewer_anchor_facts`.
 * @param qb - The query builder to constrain.
 * @param options - The caller's filter options.
 */
function applyBrokenLinksFilters(
	qb: Knex.QueryBuilder,
	options: ListViewerBrokenLinksOptions,
): void {
	qb.where('is_broken', 1);
	applyEqualityOrInFilter(qb, 'status', options.status);
	if (options.urlPattern) {
		const urlPattern = options.urlPattern;
		qb.join(
			'viewer_url_refs as filter_source_url',
			'viewer_anchor_facts.source_url_ref_id',
			'filter_source_url.id',
		)
			.join(
				'viewer_url_refs as filter_dest_url',
				'viewer_anchor_facts.dest_url_ref_id',
				'filter_dest_url.id',
			)
			.where((sub) => {
				sub
					.where('filter_source_url.url', 'like', urlPattern)
					.orWhere('filter_dest_url.url', 'like', urlPattern);
			});
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
 * Runs one `viewer_anchor_facts` read via the shared {@link readKeysetWindow}:
 * applies filters, an optional keyset predicate, an `ORDER BY` in
 * `orderDirection`, and `limit + 1` rows (the `+1` lets the caller detect
 * "is there another row past this page" without a second query). Unlike
 * `list-viewer-pages.ts`'s equivalent, no id-then-join step follows:
 * URL ref ids and status are already sufficient for sorting and cursoring;
 * full URL strings are resolved from `viewer_url_refs` only after the
 * window is limit-bounded.
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
		source_url_ref_id: number;
		dest_url_ref_id: number;
		status: number | null;
		is_external_link: number;
	})[]
> {
	return readKeysetWindow(
		knex,
		'viewer_anchor_facts',
		(qb) => applyBrokenLinksFilters(qb, options),
		[
			'edge_id',
			'source_url_ref_id',
			'dest_url_ref_id',
			'status',
			'status_sort_key',
			'status_desc_key',
			'is_external_link',
		],
		spec,
		orderDirection,
		limit,
		keyset,
		offset,
	);
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
 * @param row.source_url
 * @param row.dest_url
 * @param row.status
 * @param row.is_external_link
 * @returns The corresponding {@link LinkEntry}.
 */
function toLinkEntry(row: {
	source_url: string;
	dest_url: string;
	status: number | null;
	is_external_link?: number;
}): LinkEntry {
	return {
		sourceUrl: row.source_url,
		destUrl: row.dest_url,
		status: row.status,
		isExternal: !!row.is_external_link,
		textContent: null,
	};
}

/**
 * Reads one URL from a post-window `viewer_url_refs` lookup result.
 * @param urlByRefId - Lookup map returned by {@link resolveViewerUrlRefs}.
 * @param refId - The URL reference id required by one result row.
 * @returns The URL string for `refId`.
 * @throws {Error} If the read model references a missing URL row.
 */
function requireUrlRef(urlByRefId: ReadonlyMap<number, string>, refId: number): string {
	const url = urlByRefId.get(refId);
	if (url == null) {
		throw new Error(`listViewerBrokenLinks: missing viewer_url_refs row ${refId}`);
	}
	return url;
}

/**
 * Lists broken links from `viewer_anchor_facts` — the read-model-backed,
 * cursor-paginated counterpart of `listLinks(accessor, { type: 'broken' })`
 * that powers `/api/links?type=broken`'s fast path.
 *
 * Filter/sort resolution runs entirely against `viewer_anchor_facts`; there
 * URL strings are resolved from `viewer_url_refs` after the id window is
 * limited, so the edge table stays compact without changing the public
 * `LinkEntry` shape.
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
	async function buildResult(
		window: Awaited<ReturnType<typeof readAnchorFactsWindow>>,
		hasMoreAfter: boolean,
		hasMoreBefore: boolean,
	): Promise<CursorPaginatedLinkList> {
		const urlByRefId = await resolveViewerUrlRefs(
			knex,
			window.flatMap((row) => [row.source_url_ref_id, row.dest_url_ref_id]),
		);
		const items = window.map((row) =>
			toLinkEntry({
				source_url: requireUrlRef(urlByRefId, row.source_url_ref_id),
				dest_url: requireUrlRef(urlByRefId, row.dest_url_ref_id),
				status: row.status,
				is_external_link: row.is_external_link,
			}),
		);
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
			return await buildResult(window, true, hasMoreBefore);
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
		return await buildResult(window, hasMoreAfter, true);
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
	return await buildResult(window, hasMoreAfter, offset > 0);
}
