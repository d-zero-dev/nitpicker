/**
 * Narrows a possibly-array filter value down to the single scalar a legacy
 * (pre-read-model) query function expects. An array collapses to its first
 * element — legacy paths only run when the read model is absent, stale, or
 * deliberately bypassed (stub mode), so multi-select there degrades to
 * single-select rather than throwing or silently matching zero rows (legacy
 * predicates compare with strict equality, which an array value would never
 * satisfy).
 * @param value - A scalar, an array of scalars, or `undefined`/`null`.
 * @returns The scalar to pass to the legacy function, or `undefined` for "no
 *   filter".
 * @example
 * const legacyOptions = {
 *   status: resolveLegacyFilterValue(options.status),
 * };
 */
export function resolveLegacyFilterValue<T>(
	value: T | readonly T[] | undefined,
): T | undefined {
	if (value == null) return undefined;
	if (Array.isArray(value)) {
		return value[0] as T | undefined;
	}
	return value as T;
}
