/**
 * Parses a `?page=N` query value into a 1-indexed integer.
 *
 * Anything non-numeric, non-integer, ≤ 0, or `null` collapses to `1` — the
 * viewer never deep-links to a "negative page", and operators occasionally
 * hand-edit the URL. Extracted from {@link
 * import('./use-current-page.js').useCurrentPage} so it can be unit-tested
 * without a React Router context.
 * @param raw - The string from `URLSearchParams.get('page')`, or `null`.
 * @returns A 1-indexed page number (always ≥ 1).
 */
export function parsePageParam(raw: string | null): number {
	if (raw === null || raw.length === 0) {
		return 1;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
		return 1;
	}
	return parsed;
}
