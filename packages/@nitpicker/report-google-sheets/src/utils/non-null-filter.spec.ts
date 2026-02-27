import { describe, it, expect } from 'vitest';

import { nonNullFilter } from './non-null-filter.js';

describe('nonNullFilter', () => {
	it('returns true for non-null values', () => {
		expect(nonNullFilter(0)).toBe(true);
		expect(nonNullFilter('')).toBe(true);
		expect(nonNullFilter(false)).toBe(true);
		expect(nonNullFilter('hello')).toBe(true);
		expect(nonNullFilter(42)).toBe(true);
	});

	it('returns false for null', () => {
		expect(nonNullFilter(null)).toBe(false);
	});

	it('returns false for undefined', () => {
		expect(nonNullFilter()).toBe(false);
	});

	it('works as array filter to remove nulls', () => {
		const items = [1, null, 2, undefined, 3];
		const filtered = items.filter(nonNullFilter);
		expect(filtered).toEqual([1, 2, 3]);
	});
});
