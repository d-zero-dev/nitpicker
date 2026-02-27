import type { ExURL } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { injectScopeAuth } from './inject-scope-auth.js';

/**
 * Create a scope map from hostname-URL pairs for testing.
 * @param entries - Array of [hostname, urls] tuples.
 * @returns A map from hostname to parsed ExURL arrays.
 */
function createScope(entries: [string, string[]][]): Map<string, ExURL[]> {
	return new Map(
		entries.map(([h, urls]) => [h, urls.map((u) => parseUrl(u)!).filter(Boolean)]),
	);
}

describe('injectScopeAuth', () => {
	it('injects auth from matching scope URL', () => {
		const url = parseUrl('https://example.com/blog/post')!;
		const scope = createScope([['example.com', ['https://user:pass@example.com/blog']]]);
		injectScopeAuth(url, scope);
		expect(url.username).toBe('user');
		expect(url.password).toBe('pass');
	});

	it('does not inject auth when hostname does not match', () => {
		const url = parseUrl('https://other.com/page')!;
		const scope = createScope([['example.com', ['https://user:pass@example.com/']]]);
		injectScopeAuth(url, scope);
		// username/password are null for URLs parsed without auth
		expect(url.username).toBeNull();
		expect(url.password).toBeNull();
	});
});
