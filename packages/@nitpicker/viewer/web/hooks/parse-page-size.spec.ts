import { describe, expect, it } from 'vitest';

import { parsePageSize } from './parse-page-size.js';

describe('parsePageSize', () => {
	it('accepts the six canonical page sizes', () => {
		expect(parsePageSize(50)).toBe(50);
		expect(parsePageSize(100)).toBe(100);
		expect(parsePageSize(200)).toBe(200);
		expect(parsePageSize(500)).toBe(500);
		expect(parsePageSize(750)).toBe(750);
		expect(parsePageSize(1000)).toBe(1000);
	});

	it('rejects nearby unsupported values (no fuzzy snap)', () => {
		expect(parsePageSize(49)).toBeNull();
		expect(parsePageSize(51)).toBeNull();
		expect(parsePageSize(99)).toBeNull();
		expect(parsePageSize(101)).toBeNull();
		expect(parsePageSize(150)).toBeNull();
		expect(parsePageSize(199)).toBeNull();
		expect(parsePageSize(201)).toBeNull();
		expect(parsePageSize(499)).toBeNull();
		expect(parsePageSize(501)).toBeNull();
		expect(parsePageSize(749)).toBeNull();
		expect(parsePageSize(751)).toBeNull();
		expect(parsePageSize(999)).toBeNull();
		expect(parsePageSize(1001)).toBeNull();
	});

	it('rejects zero and negatives', () => {
		expect(parsePageSize(0)).toBeNull();
		expect(parsePageSize(-50)).toBeNull();
		expect(parsePageSize(-100)).toBeNull();
	});

	it('rejects NaN, Infinity, and non-finite values', () => {
		expect(parsePageSize(Number.NaN)).toBeNull();
		expect(parsePageSize(Number.POSITIVE_INFINITY)).toBeNull();
		expect(parsePageSize(Number.NEGATIVE_INFINITY)).toBeNull();
	});

	it('rejects non-numeric inputs (string, null, undefined, object)', () => {
		expect(parsePageSize('100')).toBeNull();
		expect(parsePageSize(null)).toBeNull();
		expect(parsePageSize()).toBeNull();
		expect(parsePageSize({})).toBeNull();
		expect(parsePageSize([100])).toBeNull();
	});
});
