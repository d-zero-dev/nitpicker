/**
 * Tests whether `itemValue` matches an in-memory filter value: a scalar
 * behaves like `itemValue === filterValue`, an array behaves like an OR
 * across all supplied values, and `undefined`/`null`/an empty array all mean
 * "no filter" (every row matches). Mirrors {@link applyEqualityOrInFilter}'s
 * contract for callers filtering a plain in-memory array instead of a Knex
 * query builder.
 * @param itemValue - The row's value for the filtered field.
 * @param filterValue - A scalar, an array of scalars, or `undefined`/`null`
 *   for "no filter".
 * @returns Whether the row should be kept.
 * @example
 * items.filter((item) => matchesAnyFilterValue(item.kind, options.kind));
 */
export function matchesAnyFilterValue<T>(
	itemValue: T,
	filterValue: T | readonly T[] | undefined | null,
): boolean {
	if (filterValue == null) return true;
	if (!Array.isArray(filterValue)) return itemValue === filterValue;
	if (filterValue.length === 0) return true;
	return (filterValue as readonly T[]).includes(itemValue);
}
