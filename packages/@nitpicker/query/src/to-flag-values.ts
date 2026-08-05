/**
 * Converts a boolean filter value (scalar or array) into the `0`/`1` form a
 * `viewer_*` boolean column stores, so it can be passed straight to
 * {@link import('./apply-equality-or-in-filter.js').applyEqualityOrInFilter}
 * (which only accepts `string | number`, never `boolean`).
 *
 * `trueValue`/`falseValue` let a caller invert the mapping for a
 * negated-polarity column — e.g. `missingTitle: true` (the public filter)
 * must select rows where `has_title` is `0`, not `1`.
 * @param value - A scalar, an array of scalars, or `undefined`/`null`.
 * @param trueValue - The column value that corresponds to `true`. Defaults to `1`.
 * @param falseValue - The column value that corresponds to `false`. Defaults to `0`.
 * @returns The `0`/`1` equivalent, preserving scalar-vs-array shape, or
 *   `undefined` for "no filter".
 * @example
 * applyEqualityOrInFilter(qb, 'is_external', toFlagValues(options.isExternal));
 * // options.isExternal: boolean | boolean[] | undefined
 * @example
 * // missingTitle: true means has_title = 0 — invert the mapping.
 * applyEqualityOrInFilter(qb, 'has_title', toFlagValues(options.missingTitle, 0, 1));
 */
export function toFlagValues(
	value: boolean | readonly boolean[] | null | undefined,
	trueValue: 0 | 1 = 1,
	falseValue: 0 | 1 = 0,
): (0 | 1) | (0 | 1)[] | undefined {
	if (value == null) return undefined;
	if (!Array.isArray(value)) {
		return value ? trueValue : falseValue;
	}
	return value.map((flag) => (flag ? trueValue : falseValue));
}
