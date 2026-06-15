import type { ContentTypeCount } from '@nitpicker/query';

/**
 * Visible (non-zero) entries with their pre-computed total. The shape is
 * what the stacked-bar component renders one segment + one legend row per.
 */
export interface VisibleEntry {
	/** The content-type category. */
	category: ContentTypeCount['category'];
	/** Number of internal pages in this category. */
	internal: number;
	/** Number of external pages in this category. */
	external: number;
	/** `internal + external`, cached so downstream code (sort key, share, row builder) does not recompute. */
	total: number;
}

/**
 * Builds the visible-entries list for the stacked bar: drops zero-count
 * categories and sorts by total descending so the bar reads largest-first
 * (matching the macOS / iOS storage view convention).
 *
 * Pure — the entire visual ordering of the stacked bar flows from this
 * function, so it's unit-tested independently of React rendering.
 * @param entries - Raw per-category counts (from `SummaryResult.contentTypeDistribution`).
 * @returns Visible entries with `total` filled, sorted by total descending.
 */
export function buildStackedBarEntries(
	entries: readonly ContentTypeCount[],
): VisibleEntry[] {
	return (
		entries
			.map((entry) => ({
				category: entry.category,
				internal: entry.internal,
				external: entry.external,
				total: entry.internal + entry.external,
			}))
			.filter((entry) => entry.total > 0)
			/* Defensive client-side sort. `@nitpicker/query`'s `get-summary.ts`
		   already returns `contentTypeDistribution` sorted by total
		   descending (with a category-name tie-break), so this is currently
		   a no-op on freshly-fetched data. Kept here to keep the bar
		   reading largest-first even if a future caller passes an
		   un-sorted slice — and so the spec can pin the visual ordering
		   without depending on the upstream sort surviving refactors. */
			.toSorted((a, b) => b.total - a.total)
	);
}
