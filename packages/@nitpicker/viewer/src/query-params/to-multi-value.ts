/**
 * Applies a single-value query-param parser (`toNumber`, `toPageSource`,
 * etc.) to every element of a repeated query param (`c.req.queries(key)`),
 * so a multi-select checkbox filter's `?status=200&status=404` reaches a
 * fast-path `Options` field as `number[]` instead of raw strings. Elements
 * the parser rejects (`toNumber`/`toPageSource` etc. return `undefined` for
 * an unrecognised value) are dropped rather than left in the array — every
 * call site needs this "silently ignore an invalid selection" behavior
 * (matching the single-value `toX` convention), so it lives here once
 * instead of being re-implemented at each of this function's call sites.
 * @param values - The raw repeated query-string values, or `undefined` if
 *   the param was never supplied.
 * @param toValue - The single-value parser to apply to each element.
 * @returns The parsed array with rejected elements dropped, or `undefined`
 *   if `values` was `undefined`.
 * @example
 * const status = toMultiValue(c.req.queries('status'), toNumber);
 * // status: number[] | undefined
 */
export function toMultiValue<T>(
	values: string[] | undefined,
	toValue: (value: string) => T,
): NonNullable<T>[] | undefined {
	if (values == null) return undefined;
	return values
		.map((value) => toValue(value))
		.filter((value): value is NonNullable<T> => value != null);
}
