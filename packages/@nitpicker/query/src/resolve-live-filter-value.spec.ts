import { describe, expect, it } from 'vitest';

import { resolveLiveFilterValue } from './resolve-live-filter-value.js';

describe('resolveLiveFilterValue', () => {
	it('returns a scalar value unchanged', () => {
		expect(resolveLiveFilterValue(404)).toBe(404);
	});

	it('returns the first element of an array', () => {
		expect(resolveLiveFilterValue([404, 500])).toBe(404);
	});

	it('returns undefined for undefined', () => {
		expect(resolveLiveFilterValue()).toBeUndefined();
	});

	it('returns undefined for an empty array', () => {
		expect(resolveLiveFilterValue([])).toBeUndefined();
	});
});
