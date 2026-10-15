/** The addon reads `4294967295` as "none", so no id may take that value. */
const MAX_ID = 4_294_967_294;

/**
 * Checks that a row id survives being stored in a `u32` array: a typed array
 * wraps `2**32` to `0` and truncates `1.5` to `1`, which here would join the
 * wrong pages without any error.
 * @param value - The id (a database row id).
 * @param what - What the id is, for the error message.
 * @returns `value`, unchanged.
 * @throws {RangeError} When `value` is not an integer in `0..=4294967294`.
 * @example
 * ```ts
 * assertU32Id(7, 'candidate id'); // 7
 * assertU32Id(2 ** 32, 'candidate id'); // throws RangeError
 * ```
 */
export function assertU32Id(value: number, what: string): number {
	if (!Number.isInteger(value) || value < 0 || value > MAX_ID) {
		throw new RangeError(`${what}: ${value} is not an integer in 0..=${MAX_ID}`);
	}
	return value;
}
