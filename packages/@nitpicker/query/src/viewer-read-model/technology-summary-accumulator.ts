import type { TechnologySourceRow, TechnologySummaryInsertRow } from './types.js';

/** Running totals for one technology. */
interface TechnologyEntry {
	category: string | null;
	pageCount: number;
	confidenceSum: number;
}

/**
 * Folds `page_technologies` rows into the per-technology
 * `viewer_technology_summary` rows as they are read, so the build holds one
 * entry per distinct technology. Why not collect the rows first: there is one
 * row per (page, technology) pair — millions on a large archive — and nothing
 * needs them after they are counted.
 *
 * Rows may be added in any number of chunks; the result is the same as one
 * batch over all of them, including row order (technologies come out in the
 * order each was first seen).
 * @example
 * const summary = new TechnologySummaryAccumulator();
 * for (const chunk of technologyRowChunks) {
 *   summary.add(chunk);
 * }
 * const rows = summary.toRows();
 */
export class TechnologySummaryAccumulator {
	readonly #byTechnology = new Map<string, TechnologyEntry>();

	/**
	 * Adds a chunk of rows. The rows are read, not kept.
	 * @param rows - `page_technologies` rows joined to their page's URL.
	 */
	add(rows: readonly TechnologySourceRow[]): void {
		for (const row of rows) {
			const entry = this.#byTechnology.get(row.technology);
			if (entry) {
				entry.pageCount += 1;
				entry.confidenceSum += row.confidence;
				entry.category ??= row.category;
			} else {
				this.#byTechnology.set(row.technology, {
					category: row.category,
					pageCount: 1,
					confidenceSum: row.confidence,
				});
			}
		}
	}

	/**
	 * The `viewer_technology_summary` rows for everything added so far.
	 * @returns One row per technology, in first-seen order.
	 */
	toRows(): TechnologySummaryInsertRow[] {
		return [...this.#byTechnology.entries()].map(([technology, entry]) => ({
			technology,
			category: entry.category,
			detected_page_count: entry.pageCount,
			avg_confidence: Math.round(entry.confidenceSum / entry.pageCount),
		}));
	}
}
