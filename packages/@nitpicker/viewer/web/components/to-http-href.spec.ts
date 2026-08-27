import { describe, expect, it } from 'vitest';

import { toHttpHref } from './to-http-href.js';

describe('toHttpHref', () => {
	it('keeps HTTP and HTTPS page URLs as hrefs', () => {
		expect(toHttpHref('https://example.com/docs')).toBe('https://example.com/docs');
		expect(toHttpHref('http://example.com/docs')).toBe('http://example.com/docs');
	});

	it('refuses schemes that would run in a file:// document', () => {
		expect(toHttpHref('javascript:alert(1)')).toBeUndefined();
		expect(toHttpHref('data:text/html,hi')).toBeUndefined();
		expect(toHttpHref('file:///tmp/report.html')).toBeUndefined();
	});

	it('refuses strings that are not absolute URLs', () => {
		expect(toHttpHref('/docs')).toBeUndefined();
		expect(toHttpHref('not a url')).toBeUndefined();
	});
});
