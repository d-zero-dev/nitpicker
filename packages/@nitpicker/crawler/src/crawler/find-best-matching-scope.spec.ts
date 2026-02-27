import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { findBestMatchingScope } from './find-best-matching-scope.js';

describe('findBestMatchingScope', () => {
	it('returns the deepest matching scope URL', () => {
		const url = parseUrl('https://example.com/blog/post/1')!;
		const scopes = [
			parseUrl('https://example.com/blog')!,
			parseUrl('https://example.com/blog/post')!,
		];
		const result = findBestMatchingScope(url, scopes);
		expect(result).not.toBeNull();
		expect(result!.pathname).toBe('/blog/post');
	});

	it('returns null when no scope matches', () => {
		const url = parseUrl('https://other.com/page')!;
		const scopes = [parseUrl('https://example.com/')!];
		const result = findBestMatchingScope(url, scopes);
		expect(result).toBeNull();
	});

	it('returns null for empty scopes array', () => {
		const url = parseUrl('https://example.com/page')!;
		const result = findBestMatchingScope(url, []);
		expect(result).toBeNull();
	});

	it('does not match root scope without trailing slash against subpath', () => {
		// Root URL https://example.com has paths [''], while /page has paths ['page']
		// isPathMatch(['page'], ['']) fails because 'page' !== ''
		const url = parseUrl('https://example.com/page')!;
		const scopes = [parseUrl('https://example.com')!];
		const result = findBestMatchingScope(url, scopes);
		expect(result).toBeNull();
	});
});
