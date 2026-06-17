import { describe, expect, it } from 'vitest';

import { derivePageSource } from './derive-page-source.js';

describe('derivePageSource', () => {
	it('returns undefined outside inventory mode (DB DEFAULT crawled applies)', () => {
		expect(derivePageSource(null, 'https://example.com/foo')).toBeUndefined();
	});

	it('labels URLs present in seedUrls as inventory-seed', () => {
		const seedUrls = new Set([
			'https://example.com/seed-a',
			'https://example.com/seed-b',
		]);
		expect(derivePageSource({ seedUrls }, 'https://example.com/seed-a')).toBe(
			'inventory-seed',
		);
	});

	it('labels URLs not in seedUrls as inventory-discovered', () => {
		const seedUrls = new Set(['https://example.com/seed-a']);
		expect(derivePageSource({ seedUrls }, 'https://example.com/derived')).toBe(
			'inventory-discovered',
		);
	});

	it('membership is exact-string — query/auth differences are NOT collapsed here', () => {
		// The caller passes the `withoutHashAndAuth` form, so query strings
		// remain part of the key. Ambiguity belongs in the caller (Crawler),
		// not in this pure helper.
		const seedUrls = new Set(['https://example.com/page?lang=ja']);
		expect(derivePageSource({ seedUrls }, 'https://example.com/page?lang=en')).toBe(
			'inventory-discovered',
		);
		expect(derivePageSource({ seedUrls }, 'https://example.com/page?lang=ja')).toBe(
			'inventory-seed',
		);
	});
});
