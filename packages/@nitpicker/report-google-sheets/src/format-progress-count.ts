/**
 * Formats a processed/total pair as a human-readable `"1,234/5,000 rows
 * (25%)"` fragment — so a reader doesn't have to guess what a bare `N/M`
 * number means or do the percentage math themselves. Mirrors
 * `@nitpicker/cli`'s `format-progress-count.ts`; duplicated here rather than
 * imported because `report-google-sheets` cannot depend on `cli` (the
 * dependency direction is reversed — `cli` depends on `report-google-sheets`).
 * @param processed - Units processed so far.
 * @param total - Total units to process.
 * @param unit - Plural unit noun to display. Defaults to `"rows"`.
 * @returns e.g. `"250/500 rows (50%)"`. `100%` when `total` is `0` (nothing
 *   to do counts as already done, not `0%`).
 * @example
 * ```ts
 * formatProgressCount(250, 500); // "250/500 rows (50%)"
 * formatProgressCount(23, 57, 'edges'); // "23/57 edges (40%)"
 * ```
 */
export function formatProgressCount(
	processed: number,
	total: number,
	unit = 'rows',
): string {
	const percent = total > 0 ? Math.floor((processed / total) * 100) : 100;
	return `${processed.toLocaleString()}/${total.toLocaleString()} ${unit} (${percent}%)`;
}
