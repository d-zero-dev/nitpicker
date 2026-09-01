/**
 * Formats the operator-facing summary printed once after a `--recrawl` run
 * skipped one or more invalid lines: `<skipped> of <total> lines skipped as
 * invalid; continuing with <valid> URLs`.
 *
 * Mirrors `formatInventorySkipSummary` with `recrawl list` in place of
 * `inventory list` — see that function's JSDoc for why this is a separate
 * function rather than a shared parameter.
 * @param skippedCount - Number of lines dropped for failing URL validation.
 * @param totalCount - Total lines read from the list file (valid + invalid).
 * @returns The formatted summary line, ready for `console.warn`.
 * @example
 * ```ts
 * formatRecrawlSkipSummary(12, 1234);
 * // '[nitpicker] recrawl list: 12 of 1234 lines skipped as invalid; continuing with 1222 URLs'
 * ```
 */
export function formatRecrawlSkipSummary(
	skippedCount: number,
	totalCount: number,
): string {
	const validCount = totalCount - skippedCount;
	return `[nitpicker] recrawl list: ${skippedCount} of ${totalCount} lines skipped as invalid; continuing with ${validCount} URLs`;
}
