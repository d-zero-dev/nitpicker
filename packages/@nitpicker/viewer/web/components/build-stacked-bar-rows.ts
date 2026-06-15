import type { VisibleEntry } from './build-stacked-bar-entries.js';
import type { ContentTypeCount } from '@nitpicker/query';

import { buildStackedBarEntries } from './build-stacked-bar-entries.js';
import { computeStackedBarWidths } from './compute-stacked-bar-widths.js';

/**
 * One render-ready row of the stacked bar: a {@link VisibleEntry} plus its
 * pre-computed width (for the segment CSS) and ratio (for the legend
 * percent label and the segment tooltip).
 *
 * The two derived numbers are stored together so the segment and the
 * legend row cannot drift — both consume the same `ratio`, so the
 * tooltip percent and the legend percent are guaranteed to agree.
 */
export interface StackedBarRow {
	/** The visible entry (category, counts, total). */
	entry: VisibleEntry;
	/** Raw proportional width in percent (`total / grandTotal × 100`). */
	width: number;
	/** Raw share as a 0–1 ratio, fed to `formatPercent` for display. */
	ratio: number;
}

/**
 * Composes the full render-ready row list for the content-type stacked bar.
 *
 * Drops zero categories, sorts by total descending, and joins the
 * proportional width and ratio onto each entry. Returns `[]` when the
 * grand total is zero — the parent component uses that to suppress the
 * whole bar.
 *
 * Extracted as a pure function so the index-correlation between
 * `widths[i]` and `visible[i]` is unit-testable in node (the viewer
 * runs without jsdom). If this lived inline in the JSX, an off-by-one
 * here would only surface in Playwright E2E.
 * @param entries - Per-category counts (from `SummaryResult.contentTypeDistribution`).
 * @returns Render-ready rows, or `[]` when there is nothing to render.
 */
export function buildStackedBarRows(
	entries: readonly ContentTypeCount[],
): StackedBarRow[] {
	const visible = buildStackedBarEntries(entries);
	const grandTotal = visible.reduce((acc, entry) => acc + entry.total, 0);
	if (grandTotal === 0) {
		return [];
	}
	const widths = computeStackedBarWidths(visible, grandTotal);
	return visible.map((entry, index) => ({
		entry,
		width: widths[index],
		ratio: entry.total / grandTotal,
	}));
}
