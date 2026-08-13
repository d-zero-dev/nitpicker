import type {
	CursorPaginatedPageList,
	ListViewerPagesOptions,
	PageListFacets,
} from './types.js';
import type {
	ViewerPagesKeysetRow,
	ViewerPagesSortSpec,
} from './viewer-pages-cursor/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { applyViewerPagesFilters } from './apply-viewer-pages-filters.js';
import { countViewerPagesTotal } from './count-viewer-pages-total.js';
import { joinViewerPageIdsToListItems } from './join-viewer-page-ids-to-list-items.js';
import { readViewerPageFacets } from './read-viewer-page-facets.js';
import { readKeysetWindow } from './viewer-cursor-kit/read-keyset-window.js';
import { buildViewerPagesFilterKey } from './viewer-pages-cursor/build-viewer-pages-filter-key.js';
import { decodeViewerPagesCursor } from './viewer-pages-cursor/decode-viewer-pages-cursor.js';
import { encodeViewerPagesCursor } from './viewer-pages-cursor/encode-viewer-pages-cursor.js';
import { extractSortValues } from './viewer-pages-cursor/extract-sort-values.js';
import { getViewerPagesSortSpec } from './viewer-pages-cursor/get-viewer-pages-sort-spec.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';

/**
 * Runs one `viewer_pages` id-resolution read via the shared
 * {@link readKeysetWindow}: applies filters, an optional keyset predicate,
 * an `ORDER BY` in `orderDirection`, and `limit + 1` rows (the `+1` lets the
 * caller detect "is there another row past this page" without a second
 * query).
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter options.
 * @param spec - The resolved sort spec (columns to select/order by).
 * @param orderDirection - The physical scan direction for this read.
 * @param limit - The page size (the read fetches `limit + 1` rows).
 * @param keyset - The keyset predicate to apply, or `undefined` for an
 *   unconstrained (initial / offset) read.
 * @param offset - Row offset for a direct `OFFSET` read (page-number jumps).
 *   Ignored when `keyset` is supplied.
 * @returns Up to `limit + 1` rows carrying `page_id` and every sort column.
 */
async function readViewerPagesWindow(
	knex: Knex,
	options: ListViewerPagesOptions,
	spec: ViewerPagesSortSpec,
	orderDirection: 'asc' | 'desc',
	limit: number,
	keyset: { operator: '>' | '<'; values: readonly (string | number)[] } | undefined,
	offset: number,
): Promise<ViewerPagesKeysetRow[]> {
	return readKeysetWindow(
		knex,
		'viewer_pages',
		(qb) => applyViewerPagesFilters(qb, options),
		['page_id'],
		spec,
		orderDirection,
		limit,
		keyset,
		offset,
	);
}

/**
 * Builds the final {@link CursorPaginatedPageList}: joins the resolved
 * `page_id` window back to full page metadata, and mints `nextCursor` /
 * `prevCursor` from the window's boundary rows.
 * @param knex - The archive's Knex instance.
 * @param window - Up to `limit + 1` rows from {@link readViewerPagesWindow},
 *   already trimmed to at most `limit` and in FINAL display order.
 * @param context - Shared cursor/response context.
 * @param context.spec - The resolved sort spec.
 * @param context.filterKey - See `buildViewerPagesFilterKey`.
 * @param context.sortBy - The effective sort field.
 * @param context.sortOrder - The effective sort direction.
 * @param context.total - The total matching row count.
 * @param context.facets - Dynamic filter enum candidates — see
 *   `readViewerPageFacets`.
 * @param context.limit - The effective page size.
 * @param context.offset - The effective `offset` to echo in the response.
 * @param context.hasMoreAfter - Whether a subsequent page exists.
 * @param context.hasMoreBefore - Whether a preceding page exists.
 * @returns The full paginated result.
 */
async function buildCursorPaginatedResult(
	knex: Knex,
	window: ViewerPagesKeysetRow[],
	context: {
		spec: ViewerPagesSortSpec;
		filterKey: string;
		sortBy:
			| 'url'
			| 'status'
			| 'title'
			| 'mainContentWordCount'
			| 'mainContentBodyWordCount'
			| 'mainContentHeadingCount'
			| 'mainContentImageCount'
			| 'mainContentTableCount'
			| 'mainContentButtonCount'
			| 'mainContentIframeCount'
			| 'mainContentVideoCount'
			| 'mainContentAudioCount'
			| 'mainContentCanvasCount'
			| 'mainContentCustomElementCount'
			| 'scrollHeightDesktop'
			| 'scrollHeightMobile'
			| 'consoleErrorCount';
		sortOrder: 'asc' | 'desc';
		total: number;
		facets: PageListFacets;
		limit: number;
		offset: number;
		hasMoreAfter: boolean;
		hasMoreBefore: boolean;
	},
): Promise<CursorPaginatedPageList> {
	const {
		spec,
		filterKey,
		sortBy,
		sortOrder,
		total,
		facets,
		limit,
		offset,
		hasMoreAfter,
		hasMoreBefore,
	} = context;
	const items = await joinViewerPageIdsToListItems(
		knex,
		window.map((row) => row.page_id),
	);
	const lastRow = window.at(-1);
	const firstRow = window[0];
	const nextCursor =
		hasMoreAfter && lastRow
			? encodeViewerPagesCursor({
					v: VIEWER_READ_MODEL_SCHEMA_VERSION,
					filterKey,
					sortBy,
					sortOrder,
					values: extractSortValues(spec, lastRow),
				})
			: null;
	const prevCursor =
		hasMoreBefore && firstRow
			? encodeViewerPagesCursor({
					v: VIEWER_READ_MODEL_SCHEMA_VERSION,
					filterKey,
					sortBy,
					sortOrder,
					values: extractSortValues(spec, firstRow),
				})
			: null;
	return { items, total, facets, offset, limit, nextCursor, prevCursor };
}

/**
 * Lists pages from `viewer_pages` — the read-model-backed, cursor-paginated
 * counterpart of `listPages` that powers `/api/pages`'s fast path.
 *
 * The contract: filter/sort resolution runs entirely against the narrow,
 * indexed `viewer_pages` table; the wide write-model `pages` table is joined
 * only after the id set is `limit`-bounded (see
 * `joinViewerPageIdsToListItems`), so the wide read stays bounded.
 * The initial read (no `cursor`), the forward keyset read, the backward
 * keyset read, and the direct-`offset` read are four separate code paths —
 * no `(:cursor IS NULL OR …)`-style nullable predicate ties them together.
 *
 * `options.cursor` takes priority over `options.offset` when both are
 * supplied. `options.offset` (page-number jumps / MPA pagination) reads
 * directly from `viewer_pages` with a plain `OFFSET` — still far cheaper
 * than the live `listPages` path because `viewer_pages` is a narrow,
 * fully-covered-by-index table, unlike the wide `pages` table `listPages`
 * scans.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this — it assumes
 *   `viewer_pages` exists and trusts its content.
 * @param options - Filter, sort, and pagination options.
 * @returns A cursor-paginated list of page entries, response-shape-compatible
 *   with `listPages`'s `PaginatedPageList` plus `nextCursor`/`prevCursor`.
 * @throws {Error} If `options.cursor` is malformed, stale, or was minted
 *   under a different filter/sort combination.
 * @example
 * // Virtual-scroll continuation — the caller only ever inspects nextCursor:
 * const page1 = await listViewerPages(accessor, { limit: 100 });
 * const page2 = page1.nextCursor
 *   ? await listViewerPages(accessor, { limit: 100, cursor: page1.nextCursor })
 *   : null;
 */
export async function listViewerPages(
	accessor: ArchiveAccessor,
	options: ListViewerPagesOptions = {},
): Promise<CursorPaginatedPageList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';
	const spec = getViewerPagesSortSpec(sortBy, sortOrder);
	const filterKey = buildViewerPagesFilterKey(options);

	const [total, facets] = await Promise.all([
		countViewerPagesTotal(knex, options),
		readViewerPageFacets(knex, options.contentTypeCategory),
	]);

	if (options.cursor) {
		const decoded = decodeViewerPagesCursor(options.cursor, {
			filterKey,
			sortBy,
			sortOrder,
			expectedValueCount: spec.columns.length,
		});
		if (options.direction === 'prev') {
			const oppositeDirection = spec.scanDirection === 'asc' ? 'desc' : 'asc';
			const fetched = await readViewerPagesWindow(
				knex,
				options,
				spec,
				oppositeDirection,
				limit,
				{ operator: spec.scanDirection === 'asc' ? '<' : '>', values: decoded.values },
				0,
			);
			const hasMoreBefore = fetched.length > limit;
			// Fetched in the opposite (nearest-cursor-first) order — reverse to
			// restore ascending display order.
			const window = fetched.slice(0, limit).toReversed();
			return buildCursorPaginatedResult(knex, window, {
				spec,
				filterKey,
				sortBy,
				sortOrder,
				total,
				facets,
				limit,
				offset: options.offset ?? 0,
				hasMoreAfter: true,
				hasMoreBefore,
			});
		}
		const fetched = await readViewerPagesWindow(
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
		return buildCursorPaginatedResult(knex, window, {
			spec,
			filterKey,
			sortBy,
			sortOrder,
			total,
			facets,
			limit,
			offset: options.offset ?? 0,
			hasMoreAfter,
			hasMoreBefore: true,
		});
	}

	const offset = options.offset ?? 0;
	const fetched = await readViewerPagesWindow(
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
	return buildCursorPaginatedResult(knex, window, {
		spec,
		filterKey,
		sortBy,
		sortOrder,
		total,
		facets,
		limit,
		offset,
		hasMoreAfter,
		hasMoreBefore: offset > 0,
	});
}
