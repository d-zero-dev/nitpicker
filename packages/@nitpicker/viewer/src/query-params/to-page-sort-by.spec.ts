import { describe, expect, it } from 'vitest';

import { toPageSortBy } from './to-page-sort-by.js';

describe('toPageSortBy', () => {
	it('returns undefined for missing input', () => {
		expect(toPageSortBy()).toBeUndefined();
	});

	it('returns undefined for empty string', () => {
		expect(toPageSortBy('')).toBeUndefined();
	});

	it('returns the narrowed value for every known sort field', () => {
		expect(toPageSortBy('url')).toBe('url');
		expect(toPageSortBy('status')).toBe('status');
		expect(toPageSortBy('title')).toBe('title');
	});

	it('returns undefined for unknown values (silent drop)', () => {
		expect(toPageSortBy('bogus')).toBeUndefined();
		expect(toPageSortBy('URL')).toBeUndefined();
		expect(toPageSortBy('__proto__')).toBeUndefined();
	});
});
