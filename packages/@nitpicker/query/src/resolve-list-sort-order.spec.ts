import { describe, expect, it } from 'vitest';

import { resolveListSortOrder } from './resolve-list-sort-order.js';

describe('resolveListSortOrder', () => {
	it('returns "asc" when requested', () => {
		expect(resolveListSortOrder('asc', 'desc')).toBe('asc');
	});

	it('returns "desc" when requested', () => {
		expect(resolveListSortOrder('desc', 'asc')).toBe('desc');
	});

	it('returns the fallback when sortOrder is undefined', () => {
		expect(resolveListSortOrder(undefined, 'asc')).toBe('asc');
	});
});
