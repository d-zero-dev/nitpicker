import { describe, expect, it } from 'vitest';

import { resolveLegacyFilterValue } from './resolve-legacy-filter-value.js';

describe('resolveLegacyFilterValue', () => {
	it('returns a scalar value unchanged', () => {
		expect(resolveLegacyFilterValue(404)).toBe(404);
	});

	it('returns the first element of an array', () => {
		expect(resolveLegacyFilterValue([404, 500])).toBe(404);
	});

	it('returns undefined for undefined', () => {
		expect(resolveLegacyFilterValue()).toBeUndefined();
	});

	it('returns undefined for an empty array', () => {
		expect(resolveLegacyFilterValue([])).toBeUndefined();
	});
});
