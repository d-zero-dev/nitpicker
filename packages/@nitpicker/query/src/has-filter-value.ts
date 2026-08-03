/**
 * Tests whether a scalar-or-array filter value should be treated as
 * "present" — the same "no filter" contract `applyEqualityOrInFilter`/
 * `matchesAnyFilterValue` use, but usable in an `if` branch that needs to
 * choose between applying the filter and falling back to a different
 * default predicate. A bare `if (options.x)` truthiness check is wrong for
 * an array-typed field: `[]` is truthy in JavaScript even though it means
 * the same "no filter" as `undefined`.
 * @param value - A scalar, an array of scalars, or `undefined`/`null`.
 * @returns Whether the value should be treated as an active filter.
 * @example
 * if (hasFilterValue(options.contentTypeCategory)) {
 *   applyEqualityOrInFilter(qb, 'content_category', options.contentTypeCategory);
 * } else {
 *   qb.whereIn('content_category', ['html', 'unknown']);
 * }
 */
export function hasFilterValue<T>(value: T | readonly T[] | null | undefined): boolean {
	if (value == null) return false;
	return Array.isArray(value) ? value.length > 0 : true;
}
