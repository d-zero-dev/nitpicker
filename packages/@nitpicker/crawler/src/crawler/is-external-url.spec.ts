import type { ExURL } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { isExternalUrl } from './is-external-url.js';

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

describe('isExternalUrl', () => {
	it('returns false when hostname is in scope', () => {
		const url = parseUrl('https://example.com/page')!;
		const scope = createScope([['example.com', ['https://example.com/']]]);
		expect(isExternalUrl(url, scope)).toBe(false);
	});

	it('returns true when hostname is not in scope', () => {
		const url = parseUrl('https://other.com/page')!;
		const scope = createScope([['example.com', ['https://example.com/']]]);
		expect(isExternalUrl(url, scope)).toBe(true);
	});
});
