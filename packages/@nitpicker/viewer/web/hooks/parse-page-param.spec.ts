import { describe, expect, it } from 'vitest';

import { parsePageParam } from './parse-page-param.js';

describe('parsePageParam', () => {
	it('returns 1 when the param is null (no `?page=`)', () => {
		expect(parsePageParam(null)).toBe(1);
	});

	it('returns 1 when the param is the empty string', () => {
		expect(parsePageParam('')).toBe(1);
	});

	it('returns the parsed integer for a positive integer', () => {
		expect(parsePageParam('3')).toBe(3);
		expect(parsePageParam('42')).toBe(42);
		expect(parsePageParam('1000')).toBe(1000);
	});

	it('clamps zero and negatives to 1', () => {
		expect(parsePageParam('0')).toBe(1);
		expect(parsePageParam('-1')).toBe(1);
		expect(parsePageParam('-99')).toBe(1);
	});

	it('rejects fractional and NaN strings', () => {
		expect(parsePageParam('1.5')).toBe(1);
		expect(parsePageParam('3.14')).toBe(1);
		expect(parsePageParam('NaN')).toBe(1);
	});

	it('accepts integer-valued scientific notation (rare but harmless)', () => {
		// `Number('2.0e1') === 20` is an integer; we accept it rather than
		// special-casing the surface form. Operators almost never type this.
		expect(parsePageParam('2.0e1')).toBe(20);
	});

	it('rejects non-numeric strings (hand-edited URLs)', () => {
		expect(parsePageParam('abc')).toBe(1);
		expect(parsePageParam('1abc')).toBe(1);
		expect(parsePageParam('  ')).toBe(1);
	});

	it('rejects Infinity', () => {
		expect(parsePageParam('Infinity')).toBe(1);
		expect(parsePageParam('-Infinity')).toBe(1);
	});
});
