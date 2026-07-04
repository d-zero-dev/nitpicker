import { describe, expect, it } from 'vitest';

import { toUrlSortKey } from './to-url-sort-key.js';

describe('toUrlSortKey', () => {
	it('extracts the comparison fields from a parsable URL', () => {
		const key = toUrlSortKey('https://example.com/about/team.html?query=1#section');

		expect(key).toEqual({
			original: 'https://example.com/about/team.html?query=1#section',
			href: 'https://example.com/about/team.html?query=1#section',
			hostname: 'example.com',
			paths: ['about', 'team.html'],
			basename: 'team',
			isIndex: false,
			extname: '.html',
			search: 'query=1',
			hash: '#section',
			protocol: 'https:',
		});
	});

	it('marks an index page as isIndex', () => {
		const key = toUrlSortKey('https://example.com/');
		expect(key.isIndex).toBe(true);
	});

	it('returns a fallback key instead of null for a URL tryParseUrl cannot parse', () => {
		const key = toUrlSortKey('not a url');

		// The fallback must never be null: a dropped row here means the
		// underlying pages/resources row gets no viewer_url_sort_keys entry
		// at all, and orderByUrlRank's scalar subquery sorts a NULL rank
		// ahead of every real one — see this function's JSDoc.
		expect(key).toEqual({
			original: 'not a url',
			href: 'not a url',
			hostname: '',
			paths: [],
			basename: '',
			isIndex: false,
			extname: '',
			search: '',
			hash: '',
			protocol: '',
		});
	});

	it('gives two identical unparsable strings the same fallback href, so they still dedup', () => {
		const a = toUrlSortKey('not a url');
		const b = toUrlSortKey('not a url');
		expect(a.href).toBe(b.href);
		expect(a.original).toBe(b.original);
	});
});
