import { describe, it, expect } from 'vitest';

import { computeContentHash } from './compute-content-hash.js';
import { decomposeUrl } from './decompose-url.js';

describe('decomposeUrl', () => {
	it('extracts every component from a canonical https URL', () => {
		const out = decomposeUrl('https://Example.COM:8443/a/b?q=1#frag');
		expect(out.scheme).toBe('https');
		expect(out.host).toBe('example.com');
		expect(out.port).toBe(8443);
		expect(out.path).toBe('/a/b');
		expect(out.fragment).toBe('frag');
		expect(out.query_hash).not.toBeNull();
		expect(out.query_hash!.equals(computeContentHash('q=1'))).toBe(true);
	});

	it('returns null port for scheme-default ports', () => {
		expect(decomposeUrl('https://example.com/').port).toBeNull();
		expect(decomposeUrl('http://example.com/').port).toBeNull();
	});

	it('returns null query_hash / fragment when absent', () => {
		const out = decomposeUrl('https://example.com/foo');
		expect(out.query_hash).toBeNull();
		expect(out.fragment).toBeNull();
	});

	it('returns empty-column shape for unparseable URLs', () => {
		const out = decomposeUrl('not-a-url');
		expect(out).toEqual({
			scheme: null,
			host: null,
			port: null,
			path: null,
			query_hash: null,
			fragment: null,
		});
	});

	it('lower-cases hostname', () => {
		expect(decomposeUrl('HTTPS://EXAMPLE.COM/').host).toBe('example.com');
	});

	it('handles URLs without authority (mailto)', () => {
		const out = decomposeUrl('mailto:user@example.com');
		expect(out.scheme).toBe('mailto');
		expect(out.host).toBeNull();
		expect(out.port).toBeNull();
	});

	it('handles data URIs and leaves path null so the base64 tail does not pollute url_refs.path', () => {
		const out = decomposeUrl('data:image/png;base64,iVBORw0KGgoAAAA=');
		expect(out.scheme).toBe('data');
		expect(out.host).toBeNull();
		expect(out.path).toBeNull();
	});

	it('leaves path null for blob: and javascript: schemes as well', () => {
		expect(decomposeUrl('blob:https://example.com/abc-def').path).toBeNull();
		expect(decomposeUrl('javascript:void(0)').path).toBeNull();
	});

	it('preserves path for regular http/https URLs', () => {
		expect(decomposeUrl('https://example.com/some/nested/path').path).toBe(
			'/some/nested/path',
		);
	});

	it('deduplicates identical query strings via query_hash', () => {
		const a = decomposeUrl('https://example.com/foo?a=1&b=2');
		const b = decomposeUrl('https://example.com/bar?a=1&b=2');
		expect(a.query_hash!.equals(b.query_hash!)).toBe(true);
	});
});
