/**
 * Type guard that filters out `null` and `undefined` values.
 * Commonly used with `Array.prototype.filter()` to narrow the
 * element type after a `.map()` that may produce nulls.
 * @param item - The value to check.
 * @returns `true` if the item is neither `null` nor `undefined`.
 * @example
 * ```ts
 * const items = [1, null, 2, undefined, 3].filter(nonNullFilter);
 * // items: number[]
 * ```
 */
export function nonNullFilter<T>(item: T): item is NonNullable<T> {
	return item != null;
}
