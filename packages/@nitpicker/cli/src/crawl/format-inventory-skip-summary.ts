/**
 * Formats the operator-facing summary printed once after an `--inventory`
 * run skipped one or more invalid lines: `<skipped> of <total> lines
 * skipped as invalid; continuing with <valid> URLs`.
 * @param skippedCount - Number of lines dropped for failing URL validation.
 * @param totalCount - Total lines read from the list file (valid + invalid).
 * @returns The formatted summary line, ready for `console.warn`.
 * @example
 * ```ts
 * formatInventorySkipSummary(12, 1234);
 * // '[nitpicker] inventory list: 12 of 1234 lines skipped as invalid; continuing with 1222 URLs'
 * ```
 */
export function formatInventorySkipSummary(
	skippedCount: number,
	totalCount: number,
): string {
	const validCount = totalCount - skippedCount;
	return `[nitpicker] inventory list: ${skippedCount} of ${totalCount} lines skipped as invalid; continuing with ${validCount} URLs`;
}
