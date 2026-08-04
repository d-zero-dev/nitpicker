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
		expect(toUnusedResourcesSortBy('contentType')).toBe('contentType');
		expect(toUnusedResourcesSortBy('contentLength')).toBe('contentLength');
	});

	it('returns undefined for unrecognised sort fields (silent drop)', () => {
		expect(toUnusedResourcesSortBy('bogus')).toBeUndefined();
	});
});
