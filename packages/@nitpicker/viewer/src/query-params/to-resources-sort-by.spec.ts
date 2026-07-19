import { describe, expect, it } from 'vitest';

import { toResourcesSortBy } from './to-resources-sort-by.js';

describe('toResourcesSortBy', () => {
	it('returns undefined for missing input', () => {
		expect(toResourcesSortBy()).toBeUndefined();
	});

	it('returns undefined for empty string', () => {
		expect(toResourcesSortBy('')).toBeUndefined();
	});

	it('returns the narrowed value for every fast-path sort field', () => {
		expect(toResourcesSortBy('url')).toBe('url');
		expect(toResourcesSortBy('status')).toBe('status');
	});

	it('returns undefined for sort fields the fast path does not index (silent drop)', () => {
		expect(toResourcesSortBy('referrerCount')).toBeUndefined();
		expect(toResourcesSortBy('contentType')).toBeUndefined();
		expect(toResourcesSortBy('bogus')).toBeUndefined();
	});
});
