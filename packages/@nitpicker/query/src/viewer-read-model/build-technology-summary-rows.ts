import type { TechnologySourceRow, TechnologySummaryInsertRow } from './types.js';

import { TechnologySummaryAccumulator } from './technology-summary-accumulator.js';

/**
 * Pure (no DB access) transform: aggregates every `page_technologies` row
 * into the site-wide technology inventory `viewer_technology_summary` reads
 * — one row per distinct technology, with its detected-page count and mean
 * confidence. The read-model counterpart of `getTechnologyInventory`'s live
 * `GROUP BY technology` query, computed once at build time instead of on
 * every read.
 *
 * `buildViewerReadModel` does not call this: it feeds a
 * {@link TechnologySummaryAccumulator} chunk by chunk, so the rows are never
 * all in memory at once. This batch form is the same computation over one
 * array, kept so its spec pins the aggregation rules (distinct-page count,
 * first non-null category, rounded mean confidence) on a plain input.
 * @param rows - Every `page_technologies` row across the whole archive
 *   (joined to nothing else — `url` is unused here, only present on
 *   {@link TechnologySourceRow} because `buildTechnologyDirectoryStatsRows`
 *   shares the same source array).
 * @returns One row per distinct technology.
 * @example
 * buildTechnologySummaryRows([
 *   { url: 'https://example.com/', technology: 'Astro', category: null, confidence: 80 },
 * ]);
 * // [{ technology: 'Astro', category: null, detected_page_count: 1, avg_confidence: 80 }]
 */
export function buildTechnologySummaryRows(
	rows: readonly TechnologySourceRow[],
): TechnologySummaryInsertRow[] {
	const accumulator = new TechnologySummaryAccumulator();
	accumulator.add(rows);
	return accumulator.toRows();
}
