import type { TechnologySourceRow, TechnologySummaryInsertRow } from './types.js';

/**
 * Pure (no DB access) transform: aggregates every `page_technologies` row
 * into the site-wide technology inventory `viewer_technology_summary` reads
 * — one row per distinct technology, with its detected-page count and mean
 * confidence. The read-model counterpart of `getTechnologyInventory`'s live
 * `GROUP BY technology` query, computed once at build time instead of on
 * every read.
 * @param rows - Every `page_technologies` row across the whole archive
 *   (joined to nothing else — `url` is unused here, only present on
 *   {@link TechnologySourceRow} because `buildTechnologyDirectoryStatsRows`
 *   shares the same source array).
 * @returns One row per distinct technology.
 */
export function buildTechnologySummaryRows(
	rows: readonly TechnologySourceRow[],
): TechnologySummaryInsertRow[] {
	const byTechnology = new Map<
		string,
		{ category: string | null; pageCount: number; confidenceSum: number }
	>();
	for (const row of rows) {
		const entry = byTechnology.get(row.technology);
		if (entry) {
			entry.pageCount += 1;
			entry.confidenceSum += row.confidence;
			entry.category ??= row.category;
		} else {
			byTechnology.set(row.technology, {
				category: row.category,
				pageCount: 1,
				confidenceSum: row.confidence,
			});
		}
	}
	return [...byTechnology.entries()].map(([technology, entry]) => ({
		technology,
		category: entry.category,
		detected_page_count: entry.pageCount,
		avg_confidence: Math.round(entry.confidenceSum / entry.pageCount),
	}));
}
