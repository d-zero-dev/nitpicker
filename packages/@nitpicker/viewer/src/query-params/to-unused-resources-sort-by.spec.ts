import { describe, expect, it } from 'vitest';

import { toUnusedResourcesSortBy } from './to-unused-resources-sort-by.js';

describe('toUnusedResourcesSortBy', () => {
	it('returns undefined for missing input', () => {
		expect(toUnusedResourcesSortBy()).toBeUndefined();
	});

	it('returns undefined for empty string', () => {
		expect(toUnusedResourcesSortBy('')).toBeUndefined();
	});

	it('returns the narrowed value for every fast-path sort field', () => {
		expect(toUnusedResourcesSortBy('url')).toBe('url');
		expect(toUnusedResourcesSortBy('status')).toBe('status');
		expect(toUnusedResourcesSortBy('source')).toBe('source');
	});

	it('returns undefined for sort fields the fast path does not index (silent drop)', () => {
		expect(toUnusedResourcesSortBy('contentType')).toBeUndefined();
		expect(toUnusedResourcesSortBy('contentLength')).toBeUndefined();
		expect(toUnusedResourcesSortBy('bogus')).toBeUndefined();
	});
});
