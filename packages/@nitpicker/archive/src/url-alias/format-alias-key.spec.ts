import { describe, it, expect } from 'vitest';

import { formatAliasKey } from './format-alias-key.js';

describe('formatAliasKey', () => {
	it('formats host + path + search with no port', () => {
		expect(
			formatAliasKey({ host: 'example.com', port: '', path: '/about/', search: '' }),
		).toBe('example.com/about/');
	});

	it('includes a non-default port with a colon separator', () => {
		expect(
			formatAliasKey({ host: 'example.com', port: '8443', path: '/about', search: '' }),
		).toBe('example.com:8443/about');
	});

	it('appends the query string verbatim', () => {
		expect(
			formatAliasKey({ host: 'example.com', port: '', path: '/about', search: '?x=1' }),
		).toBe('example.com/about?x=1');
	});
});
