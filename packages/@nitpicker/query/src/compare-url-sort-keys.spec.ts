import { pathComparator } from '@d-zero/shared/sort/path';
import { describe, expect, it } from 'vitest';

import { compareUrlSortKeys } from './compare-url-sort-keys.js';
import { toUrlSortKey } from './to-url-sort-key.js';

/**
 * URL fixtures chosen to exercise every branch of `pathComparator`: numeric
 * basenames (natural sort), `index` special-casing, differing extensions,
 * differing query/hash, differing hosts, differing protocols, and duplicate
 * hrefs that only differ in original casing/encoding.
 */
const URLS = [
	'https://example.com/image-10.jpg',
	'https://example.com/image-2.jpg',
	'https://example.com/image-1.jpg',
	'https://example.com/',
	'https://example.com/index.html',
	'https://example.com/about/',
	'https://example.com/about/index.html',
	'https://example.com/about/team.html',
	'https://example.com/file.jpg',
	'https://example.com/file.png',
	'https://example.com/page?query=1',
	'https://example.com/page?query=2',
	'https://example.com/page#section-1',
	'https://example.com/page#section-2',
	'https://a.example.com/',
	'https://b.example.com/',
	'http://example.com/insecure',
	'https://example.com/insecure',
	'https://example.com/dir-10/file.html',
	'https://example.com/dir-2/file.html',
	'https://example.com/nested/dir-10/page-3.html',
	'https://example.com/nested/dir-2/page-30.html',
];

describe('compareUrlSortKeys', () => {
	it('sorts UrlSortKeys in the same order pathComparator sorts the equivalent URLs', () => {
		const expected = [...URLS].toSorted(pathComparator);

		const keys = URLS.map((url) => toUrlSortKey(url));
		const actual = keys.toSorted(compareUrlSortKeys).map((key) => key.original);

		expect(actual).toEqual(expected);
	});

	it('treats two distinct href-equal inputs via the original-string tiebreak, same as pathComparator', () => {
		const inputs = ['https://example.com/Page', 'https://example.com/page'];
		const expected = [...inputs].toSorted(pathComparator);

		const keys = inputs.map((url) => toUrlSortKey(url));
		const actual = keys.toSorted(compareUrlSortKeys).map((key) => key.original);

		expect(actual).toEqual(expected);
	});

	it('returns 0 for identical keys', () => {
		const key = toUrlSortKey('https://example.com/same');
		expect(compareUrlSortKeys(key, { ...key })).toBe(0);
	});
});
