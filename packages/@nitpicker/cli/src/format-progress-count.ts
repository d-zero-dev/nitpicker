/**
 * Formats a processed/total pair as a human-readable `"1,234/5,000 pages
 * (25%)"` fragment — shared by the viewer read-model build progress line and
 * the three backfill progress lines (issue #294) so a reader doesn't have to
 * guess what a bare `N/M` number means or do the percentage math themselves.
 * `unit` defaults to `"pages"` (every caller before issue #294's sub-phase
 * progress counted pages); pass e.g. `"indexes"` or `"id ranges"` for a
 * sub-phase whose unit of progress isn't a page.
 * @param processed - Units processed so far.
 * @param total - Total units to process.
 * @param unit - Plural unit noun to display. Defaults to `"pages"`.
 * @returns e.g. `"250/500 pages (50%)"`. `100%` when `total` is `0` (nothing
 *   to do counts as already done, not `0%`).
 * @example
 * ```ts
 * formatProgressCount(250, 500); // "250/500 pages (50%)"
 * formatProgressCount(23, 57, 'indexes'); // "23/57 indexes (40%)"
 * ```
 */
export function formatProgressCount(
	processed: number,
	total: number,
	unit = 'pages',
): string {
	const percent = total > 0 ? Math.floor((processed / total) * 100) : 100;
	return `${processed.toLocaleString()}/${total.toLocaleString()} ${unit} (${percent}%)`;
}
