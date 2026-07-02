import { describe, expect, it } from 'vitest';

import { toPageSortOrder } from './to-page-sort-order.js';

describe('toPageSortOrder', () => {
	it('returns undefined for missing input', () => {
		expect(toPageSortOrder()).toBeUndefined();
	});

	it('returns undefined for empty string', () => {
		expect(toPageSortOrder('')).toBeUndefined();
	});

	it('returns the narrowed value for asc/desc', () => {
		expect(toPageSortOrder('asc')).toBe('asc');
		expect(toPageSortOrder('desc')).toBe('desc');
	});

	it('returns undefined for unknown values (silent drop)', () => {
		expect(toPageSortOrder('ASC')).toBeUndefined();
		expect(toPageSortOrder('ascending')).toBeUndefined();
	});
});
