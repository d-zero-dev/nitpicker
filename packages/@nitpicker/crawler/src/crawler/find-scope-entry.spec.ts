import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { findScopeEntry } from './find-scope-entry.js';

const defaultOptions: ParseURLOptions = {};

/**
 * Build a hostname-indexed scope map from URL strings for testing.
 * @param urls - Scope URLs to register.
 * @returns A map from hostname to parsed ExURL arrays.
 */
function buildScope(urls: string[]): Map<string, ExURL[]> {
	const map = new Map<string, ExURL[]>();
	for (const raw of urls) {
		const parsed = parseUrl(raw, defaultOptions);
		if (!parsed) continue;
		const existing = map.get(parsed.hostname) ?? [];
		map.set(parsed.hostname, [...existing, parsed]);
	}
	return map;
}

describe('findScopeEntry', () => {
	it('returns null when no scope entry shares the hostname', () => {
		const url = parseUrl('https://other.com/page')!;
		const scope = buildScope(['https://example.com/']);
		expect(findScopeEntry(url, scope, defaultOptions)).toBeNull();
	});

	it('returns the matching scope when hostname is in scope and path is at root', () => {
		const url = parseUrl('https://example.com/page')!;
		const scope = buildScope(['https://example.com/']);
		const matched = findScopeEntry(url, scope, defaultOptions);
		expect(matched).not.toBeNull();
		expect(matched!.hostname).toBe('example.com');
	});

	it('returns null when hostname matches but path is outside the scope entry', () => {
		const url = parseUrl('https://example.com/about')!;
		const scope = buildScope(['https://example.com/blog/']);
		expect(findScopeEntry(url, scope, defaultOptions)).toBeNull();
	});

	it('returns the deepest matching scope', () => {
		const url = parseUrl('https://example.com/blog/post/1')!;
		const scope = buildScope([
			'https://example.com/blog',
			'https://example.com/blog/post',
		]);
		const matched = findScopeEntry(url, scope, defaultOptions);
		expect(matched).not.toBeNull();
		expect(matched!.pathname).toBe('/blog/post');
	});

	it('prefers a deeper scope over a root scope (auth inheritance)', () => {
		const url = parseUrl('https://example.com/blog/post/1')!;
		const scope = buildScope([
			'https://user:pass@example.com',
			'https://admin:secret@example.com/blog/post',
		]);
		const matched = findScopeEntry(url, scope, defaultOptions);
		expect(matched).not.toBeNull();
		expect(matched!.username).toBe('admin');
	});

	it('treats a root scope (path=`/`) as matching every path under the hostname', () => {
		const url = parseUrl('https://example.com/deep/nested/page')!;
		const scope = buildScope(['https://example.com/']);
		const matched = findScopeEntry(url, scope, defaultOptions);
		expect(matched).not.toBeNull();
		expect(matched!.hostname).toBe('example.com');
	});

	it('returns null when scope map has the hostname but the array is empty', () => {
		const url = parseUrl('https://example.com/page')!;
		const scope = new Map<string, ExURL[]>([['example.com', []]]);
		expect(findScopeEntry(url, scope, defaultOptions)).toBeNull();
	});

	it('matches a multi-subpath scope for hosts with several scope entries', () => {
		const docs = parseUrl('https://example.com/docs/intro')!;
		const blog = parseUrl('https://example.com/blog/2024')!;
		const other = parseUrl('https://example.com/marketing/landing')!;
		const scope = buildScope(['https://example.com/docs/', 'https://example.com/blog/']);
		expect(findScopeEntry(docs, scope, defaultOptions)).not.toBeNull();
		expect(findScopeEntry(blog, scope, defaultOptions)).not.toBeNull();
		expect(findScopeEntry(other, scope, defaultOptions)).toBeNull();
	});

	it('returns the scope itself when URL equals scope.href exactly', () => {
		const url = parseUrl('https://example.com/blog/')!;
		const scope = buildScope(['https://example.com/blog/']);
		const matched = findScopeEntry(url, scope, defaultOptions);
		expect(matched).not.toBeNull();
		expect(matched!.pathname).toBe('/blog/');
	});

	it('matches a URL with a hash fragment against a scope without one', () => {
		const url = parseUrl('https://example.com/blog/post#section')!;
		const scope = buildScope(['https://example.com/blog/']);
		expect(findScopeEntry(url, scope, defaultOptions)).not.toBeNull();
	});

	it('matches a URL with a query string against a scope without one', () => {
		const url = parseUrl('https://example.com/blog/post?page=2')!;
		const scope = buildScope(['https://example.com/blog/']);
		expect(findScopeEntry(url, scope, defaultOptions)).not.toBeNull();
	});

	it('does not match a URL whose hostname differs even when the path matches', () => {
		const url = parseUrl('https://other.com/blog/post')!;
		const scope = buildScope(['https://example.com/blog/']);
		expect(findScopeEntry(url, scope, defaultOptions)).toBeNull();
	});
});
