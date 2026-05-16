import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { injectScopeAuth } from './inject-scope-auth.js';

describe('injectScopeAuth', () => {
	it('copies username and password from the matched scope', () => {
		const url = parseUrl('https://example.com/blog/post')!;
		const matched = parseUrl('https://user:pass@example.com/blog')!;
		injectScopeAuth(url, matched);
		expect(url.username).toBe('user');
		expect(url.password).toBe('pass');
	});

	it('leaves credentials untouched when the matched scope has no auth', () => {
		const url = parseUrl('https://example.com/blog/post')!;
		const matched = parseUrl('https://example.com/blog/')!;
		injectScopeAuth(url, matched);
		expect(url.username).toBeNull();
		expect(url.password).toBeNull();
	});

	it('mutates the url in place', () => {
		const url = parseUrl('https://example.com/page')!;
		const matched = parseUrl('https://admin:secret@example.com/')!;
		const ret = injectScopeAuth(url, matched);
		expect(ret).toBeUndefined();
		expect(url.username).toBe('admin');
		expect(url.password).toBe('secret');
	});
});
