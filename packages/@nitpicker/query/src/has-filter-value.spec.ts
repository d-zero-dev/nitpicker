import { describe, expect, it } from 'vitest';

import { hasFilterValue } from './has-filter-value.js';

describe('hasFilterValue', () => {
	it('returns false for undefined', () => {
		expect(hasFilterValue()).toBe(false);
	});

	it('returns false for null', () => {
		expect(hasFilterValue(null)).toBe(false);
	});

	it('returns false for an empty array', () => {
		expect(hasFilterValue([])).toBe(false);
	});

	it('returns true for a scalar value', () => {
		expect(hasFilterValue('html')).toBe(true);
	});

	it('returns true for a non-empty array', () => {
		expect(hasFilterValue(['html', 'pdf'])).toBe(true);
	});

	it('returns true for a falsy-but-present scalar (0)', () => {
		expect(hasFilterValue(0)).toBe(true);
	});
});
