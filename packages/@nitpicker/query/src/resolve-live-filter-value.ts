/**
 * Narrows a possibly-array filter value down to the single scalar a live
 * (pre-read-model) query function expects. An array collapses to its first
 * element — live paths only run when the read model is absent, stale, or
 * deliberately bypassed (stub mode), so multi-select there degrades to
 * single-select rather than throwing or silently matching zero rows (live
 * predicates compare with strict equality, which an array value would never
 * satisfy).
 * @param value - A scalar, an array of scalars, or `undefined`/`null`.
 * @returns The scalar to pass to the live function, or `undefined` for "no
 *   filter".
 * @example
 * const liveOptions = {
 *   status: resolveLiveFilterValue(options.status),
 * };
 */
export function resolveLiveFilterValue<T>(
	value: T | readonly T[] | undefined,
): T | undefined {
	if (value == null) return undefined;
	if (Array.isArray(value)) {
		return value[0] as T | undefined;
	}
	return value as T;
}
