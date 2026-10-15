import { describe, it, expect } from 'vitest';

import { computeAliasKeys } from './compute-alias-keys.js';

describe('computeAliasKeys', () => {
	it('folds the scheme, the host case and an index page', () => {
		expect(computeAliasKeys('http://Example.com/about/index.html')).toStrictEqual({
			tierA: 'example.com/about/',
			tierB: 'example.com/about',
		});
	});

	it('keeps the root slash in tier B', () => {
		expect(computeAliasKeys('https://example.com')).toStrictEqual({
			tierA: 'example.com/',
			tierB: 'example.com/',
		});
	});

	it('keeps a non-default port and the query, and drops the fragment', () => {
		expect(computeAliasKeys('https://example.com:8443/a?x=1#top')).toStrictEqual({
			tierA: 'example.com:8443/a?x=1',
			tierB: 'example.com:8443/a?x=1',
		});
	});

	it('returns null for what is not an http(s) URL', () => {
		expect(computeAliasKeys('mailto:a@example.com')).toBeNull();
		expect(computeAliasKeys('not a url')).toBeNull();
		expect(computeAliasKeys('')).toBeNull();
	});
});
