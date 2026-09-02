/**
 * Formats the operator-facing summary printed once after a `report --urls`
 * run skipped one or more invalid lines: `<skipped> of <total> lines skipped
 * as invalid; continuing with <valid> URLs`.
 *
 * Mirrors `formatRecrawlSkipSummary` with `report list` in place of `recrawl
 * list` — see that function's JSDoc for why this is a separate function
 * rather than a shared parameter.
 * @param skippedCount - Number of lines dropped for failing URL validation.
 * @param totalCount - Total lines read from the list file (valid + invalid).
 * @returns The formatted summary line, ready for `console.warn`.
 * @example
 * ```ts
 * formatReportUrlSkipSummary(12, 1234);
 * // '[nitpicker] report list: 12 of 1234 lines skipped as invalid; continuing with 1222 URLs'
 * ```
 */
export function formatReportUrlSkipSummary(
	skippedCount: number,
	totalCount: number,
): string {
	const validCount = totalCount - skippedCount;
	return `[nitpicker] report list: ${skippedCount} of ${totalCount} lines skipped as invalid; continuing with ${validCount} URLs`;
}
