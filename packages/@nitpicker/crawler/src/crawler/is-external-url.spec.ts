import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { isExternalUrl } from './is-external-url.js';

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

describe('isExternalUrl', () => {
	it('returns false when the URL is inside a scope entry', () => {
		const url = parseUrl('https://example.com/page')!;
		const scope = buildScope(['https://example.com/']);
		expect(isExternalUrl(url, scope, defaultOptions)).toBe(false);
	});

	it('returns true when the hostname is not in scope', () => {
		const url = parseUrl('https://other.example.com/page')!;
		const scope = buildScope(['https://example.com/']);
		expect(isExternalUrl(url, scope, defaultOptions)).toBe(true);
	});

	it('returns true when the hostname matches but the path is outside the scope entry', () => {
		const url = parseUrl('https://example.com/about')!;
		const scope = buildScope(['https://example.com/blog/']);
		expect(isExternalUrl(url, scope, defaultOptions)).toBe(true);
	});

	it('returns false for the deepest sub-path of a hierarchical scope', () => {
		const url = parseUrl('https://example.com/blog/post/1')!;
		const scope = buildScope(['https://example.com/blog/']);
		expect(isExternalUrl(url, scope, defaultOptions)).toBe(false);
	});
});
