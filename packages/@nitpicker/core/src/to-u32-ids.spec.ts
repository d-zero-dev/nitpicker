import { describe, it, expect } from 'vitest';

import { toU32Ids } from './to-u32-ids.js';

describe('toU32Ids', () => {
	it('copies integer ids', () => {
		expect([...toU32Ids([0, 1, 4_294_967_294], 'ids')]).toStrictEqual([
			0, 1, 4_294_967_294,
		]);
	});

	it('returns an empty array for no ids', () => {
		expect(toU32Ids([], 'ids')).toHaveLength(0);
	});

	it('reads an array-like that is not iterable', () => {
		expect([...toU32Ids({ length: 2, 0: 7, 1: 8 }, 'ids')]).toStrictEqual([7, 8]);
	});

	it('reads a typed array', () => {
		expect([...toU32Ids(Int32Array.of(5, 6), 'ids')]).toStrictEqual([5, 6]);
	});

	it.each([
		['a value a Uint32Array would wrap', 4_294_967_296],
		['the value the addon reads as none', 4_294_967_295],
		['a negative id', -1],
		['a fraction', 1.5],
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
	])('rejects %s', (_name, value) => {
		expect(() => toU32Ids([1, value], 'candidate ids')).toThrow(
			new RangeError(`candidate ids: ${value} is not an integer in 0..=4294967294`),
		);
	});
});
