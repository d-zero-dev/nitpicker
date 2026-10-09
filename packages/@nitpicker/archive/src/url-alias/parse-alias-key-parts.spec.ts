import { describe, it, expect } from 'vitest';

import { parseAliasKeyParts } from './parse-alias-key-parts.js';

describe('parseAliasKeyParts', () => {
	it('lowercases the host', () => {
		expect(parseAliasKeyParts('https://Example.COM/about')?.host).toBe('example.com');
	});

	it('leaves port empty for the scheme default', () => {
		expect(parseAliasKeyParts('https://example.com/about')?.port).toBe('');
	});

	it('preserves an explicit non-default port', () => {
		expect(parseAliasKeyParts('https://example.com:8443/about')?.port).toBe('8443');
	});

	it('folds an /index.{ext} path suffix to a trailing slash', () => {
		expect(parseAliasKeyParts('https://example.com/about/index.html')?.path).toBe(
			'/about/',
		);
	});

	it('leaves the query string untouched', () => {
		expect(parseAliasKeyParts('https://example.com/about?x=1')?.search).toBe('?x=1');
	});

	it('returns null for an unparseable URL', () => {
		expect(parseAliasKeyParts('not a url')).toBeNull();
	});

	it('returns null for a non-http(s) scheme', () => {
		expect(parseAliasKeyParts('ftp://example.com/file.txt')).toBeNull();
	});
});
