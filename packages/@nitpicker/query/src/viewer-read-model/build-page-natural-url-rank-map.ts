import type { PageUrlRankSourceRow } from './build-page-url-rank-map.js';

import { computeUrlSortRanks } from '@nitpicker/archive/url-sort/compute-url-sort-ranks';

/**
 * Builds a `page_id → natural_url_rank` map: a dense, zero-based integer
 * ranking of every listable page in natural URL order — the same order
 * (`computeUrlSortRanks`) the live (`listPages`) sort path uses, treating
 * numeric path segments numerically (`page2` before `page10`) rather than by
 * byte value.
 *
 * Unlike {@link import('./build-page-url-rank-map.js').buildPageUrlRankMap}
 * (BINARY collation, matching `viewer_pages.url_sort_key`'s plain `ORDER BY`),
 * this rank is what `viewer_pages`'s default `sortBy: 'url'` listing now
 * orders by — persisting it once here, at read-model build time, is what
 * lets the viewer skip ranking at every startup: the natural order is already
 * a plain integer column, not something a fast-path reader needs to
 * recompute.
 *
 * All the page URLs are ranked in one native call. That is safe for the same
 * reason {@link import('./build-page-url-rank-map.js').buildPageUrlRankMap}
 * holds the whole set: the page count (hundreds of thousands at real-world
 * scale) is small next to the combined pages+resources URL space the live
 * path ranks. Pages whose URLs are identical rank by page id.
 * @param sourceRows - Every listable `pages` row (the same set that
 *   populates `viewer_pages`).
 * @returns A map from `pages.id` to its dense rank in natural-ascending order.
 * @example
 * const rankByPageId = buildPageNaturalUrlRankMap(sourceRows);
 * const row = { ...toViewerPageInsertRow(page), natural_url_rank: rankByPageId.get(page.id)! };
 */
export function buildPageNaturalUrlRankMap(
	sourceRows: readonly PageUrlRankSourceRow[],
): Map<number, number> {
	const rowsById = sourceRows.toSorted((a, b) => a.id - b.id);
	const ranks = computeUrlSortRanks(rowsById.map((row) => row.url));
	const rankByPageId = new Map<number, number>();
	for (const [index, row] of rowsById.entries()) {
		rankByPageId.set(row.id, ranks[index]!);
	}
	return rankByPageId;
}
