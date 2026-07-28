/**
 * Normalizes a caller-supplied page size for an offset-paginated list query,
 * falling back to `defaultLimit` when the value is missing, negative, or not
 * an integer.
 * @param limit - The requested page size.
 * @param defaultLimit - The value to use when `limit` is absent or invalid.
 * @returns A safe limit for the SQL query.
 * @example
 * const limit = resolveListLimit(50, 100); // 50
 * const fallback = resolveListLimit(-1, 100); // 100
 */
export function resolveListLimit(
	limit: number | undefined,
	defaultLimit: number,
): number {
	return Number.isInteger(limit) && (limit as number) >= 0
		? (limit as number)
		: defaultLimit;
}
