import type { StackedBarRow } from './build-stacked-bar-rows.js';
import type { ContentTypeCount } from '@nitpicker/query';

import { CONTENT_TYPE_CATEGORIES } from '@nitpicker/query/categories';

/**
 * Builds the **legend** row list — every known content-type category in
 * canonical order, including zero-count categories.
 *
 * The legend's job is "what categories are even possible, and how does this
 * archive break them down?" — so a category with zero hits is still useful
 * information (it tells the user "we measured for this and found none"),
 * unlike the bar itself where a 0%-width segment carries no signal and
 * would only be confusing under the CSS `min-inline-size: 4px` floor.
 *
 * Pure — split from {@link buildStackedBarRows} so the "what's in the bar"
 * and "what's in the legend" contracts are independently asserted.
 * @param entries - Per-category counts (from `SummaryResult.contentTypeDistribution`).
 * @returns One {@link StackedBarRow} per known category, in `CONTENT_TYPE_CATEGORIES` order.
 */
export function buildStackedBarLegendRows(
	entries: readonly ContentTypeCount[],
): StackedBarRow[] {
	const byCategory = new Map(entries.map((entry) => [entry.category, entry]));
	const grandTotal = entries.reduce(
		(acc, entry) => acc + entry.internal + entry.external,
		0,
	);
	return CONTENT_TYPE_CATEGORIES.map((category) => {
		const found = byCategory.get(category);
		const internal = found?.internal ?? 0;
		const external = found?.external ?? 0;
		const total = internal + external;
		const ratio = grandTotal > 0 ? total / grandTotal : 0;
		return {
			entry: { category, internal, external, total },
			width: ratio * 100,
			ratio,
		};
	});
}
