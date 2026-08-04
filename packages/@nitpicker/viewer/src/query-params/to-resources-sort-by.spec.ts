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
		expect(toResourcesSortBy('statusText')).toBe('statusText');
		expect(toResourcesSortBy('contentType')).toBe('contentType');
		expect(toResourcesSortBy('contentLength')).toBe('contentLength');
		expect(toResourcesSortBy('isExternal')).toBe('isExternal');
		expect(toResourcesSortBy('referrerCount')).toBe('referrerCount');
		expect(toResourcesSortBy('compress')).toBe('compress');
		expect(toResourcesSortBy('cdn')).toBe('cdn');
	});

	it('returns undefined for unrecognised sort fields (silent drop)', () => {
		expect(toResourcesSortBy('bogus')).toBeUndefined();
	});
});
