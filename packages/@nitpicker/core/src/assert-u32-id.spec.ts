import { describe, it, expect } from 'vitest';

import { assertU32Id } from './assert-u32-id.js';

describe('assertU32Id', () => {
	it.each([0, 1, 4_294_967_294])('returns %d unchanged', (value) => {
		expect(assertU32Id(value, 'id')).toBe(value);
	});

	it.each([
		['a value a Uint32Array would wrap', 4_294_967_296],
		['the value the addon reads as none', 4_294_967_295],
		['a negative id', -1],
		['a fraction', 1.5],
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
	])('rejects %s', (_name, value) => {
		expect(() => assertU32Id(value, 'url id')).toThrow(
			new RangeError(`url id: ${value} is not an integer in 0..=4294967294`),
		);
	});
});
