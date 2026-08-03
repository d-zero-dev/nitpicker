import type { PageUrlRankSourceRow } from './build-page-url-rank-map.js';

import { compareUrlSortKeys } from '../compare-url-sort-keys.js';
import { toUrlSortKey } from '../to-url-sort-key.js';

/**
 * Builds a `page_id → natural_url_rank` map: a dense, zero-based integer
 * ranking of every listable page in natural URL order — the same
 * `compareUrlSortKeys` algorithm the live (`listPages`) sort path and the
 * viewer's startup external merge sort both use, treating numeric path
 * segments numerically (`page2` before `page10`) rather than by byte value.
 *
 * Unlike {@link import('./build-page-url-rank-map.js').buildPageUrlRankMap}
 * (BINARY collation, matching `viewer_pages.url_sort_key`'s plain `ORDER BY`),
 * this rank is what `viewer_pages`'s default `sortBy: 'url'` listing now
 * orders by — persisting it once here, at read-model build time, is what
 * lets the viewer skip running the external sort at every startup: the
 * natural order is already a plain integer column, not something a fast-path
 * reader needs to recompute.
 *
 * Sorting the whole page set in memory (rather than the chunked external
 * merge sort `externalSortUrls` uses) is safe here for the same reason
 * {@link import('./build-page-url-rank-map.js').buildPageUrlRankMap} already
 * does it: the archive's total page count (hundreds of thousands at
 * real-world scale) is small enough to hold and sort at once, unlike the
 * combined pages+resources URL space `externalSortUrls` covers.
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
	const sorted = sourceRows.toSorted((a, b) => {
		const comparison = compareUrlSortKeys(toUrlSortKey(a.url), toUrlSortKey(b.url));
		return comparison === 0 ? a.id - b.id : comparison;
	});
	const rankByPageId = new Map<number, number>();
	for (const [rank, row] of sorted.entries()) {
		rankByPageId.set(row.id, rank);
	}
	return rankByPageId;
}
