import type { VisibleEntry } from './build-stacked-bar-entries.js';

/**
 * Computes the raw proportional width (in percent) for each visible entry of
 * the stacked content-type bar.
 *
 * The width is `total / grandTotal × 100`, with no floor and no
 * renormalisation. Sub-pixel segments are lifted to a discoverable strip
 * by the CSS rule `.bar-segment { min-inline-size: 4px; }` — keeping the
 * floor in CSS means the legend percentage stays the true raw share,
 * and flexbox absorbs the overshoot by shrinking the larger segments.
 * Doing both in JS would require renormalising the floored widths, which
 * pushed the lifted segments back below their floor after rescale (the
 * earlier implementation's bug).
 *
 * Returns widths in the same order as `visible`, summing to 100. Returns
 * an empty array when there's nothing to render; callers should suppress
 * the bar entirely in that case.
 * @param visible - Visible entries (already filtered + sorted by `buildStackedBarEntries`).
 * @param grandTotal - Sum of every entry's `total`.
 * @returns Raw proportional widths in percent (or `[]` when nothing to render).
 */
export function computeStackedBarWidths(
	visible: readonly VisibleEntry[],
	grandTotal: number,
): number[] {
	if (grandTotal === 0 || visible.length === 0) {
		return [];
	}
	return visible.map((entry) => (entry.total / grandTotal) * 100);
}
