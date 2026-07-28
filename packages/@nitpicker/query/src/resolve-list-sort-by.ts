/**
 * Normalizes a caller-supplied sort field against an allow-list, falling
 * back to `fallback` when the value is missing or not one of `allowed`.
 * @param sortBy - The requested sort field.
 * @param allowed - The supported sort fields for this query.
 * @param fallback - The sort field to use when `sortBy` is unsupported.
 * @returns A supported sort key.
 * @example
 * const sortBy = resolveListSortBy('rule', ['url', 'rule'] as const, 'url'); // 'rule'
 */
export function resolveListSortBy<T extends string>(
	sortBy: T | undefined,
	allowed: readonly T[],
	fallback: T,
): T {
	return sortBy !== undefined && allowed.includes(sortBy) ? sortBy : fallback;
}
