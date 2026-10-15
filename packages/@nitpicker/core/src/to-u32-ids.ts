import { assertU32Id } from './assert-u32-id.js';

/**
 * Copies row ids into the `u32` array the addon takes, refusing any value a
 * `Uint32Array` would silently change (see `assertU32Id`).
 * @param values - The ids (database row ids): an array or a typed array.
 * @param what - What the ids are, for the error message.
 * @returns The ids as a `Uint32Array`.
 * @throws {RangeError} When a value is not an integer in `0..=4294967294`.
 * @example
 * ```ts
 * toU32Ids([1, 2, 3], 'candidate ids'); // Uint32Array [1, 2, 3]
 * toU32Ids([2 ** 32], 'candidate ids'); // throws RangeError
 * ```
 */
export function toU32Ids(values: ArrayLike<number>, what: string): Uint32Array {
	const ids = new Uint32Array(values.length);
	// `ArrayLike` has no iterator, so an index loop is the way to read it.
	// eslint-disable-next-line unicorn/no-for-loop
	for (let index = 0; index < values.length; index++) {
		ids[index] = assertU32Id(values[index]!, what);
	}
	return ids;
}
