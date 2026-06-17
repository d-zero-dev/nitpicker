import { describe, expect, it } from 'vitest';

import { deriveResourceSource } from './derive-resource-source.js';

describe('deriveResourceSource', () => {
	it('returns undefined outside inventory mode (DB DEFAULT crawled applies)', () => {
		expect(deriveResourceSource(null)).toBeUndefined();
	});

	it('always returns inventory-discovered when inventory mode is active', () => {
		const seedUrls = new Set(['https://example.com/seed']);
		// Sub-resources are never themselves seeds — the rule is independent
		// of which seed URL triggered the rendering, so the helper does not
		// even look at the resource URL.
		expect(deriveResourceSource({ seedUrls })).toBe('inventory-discovered');
	});

	it('ignores the seed set contents — never returns inventory-seed', () => {
		// Even an empty seed set yields inventory-discovered, mirroring the
		// `derivePageSource` contract that membership only matters for pages.
		expect(deriveResourceSource({ seedUrls: new Set() })).toBe('inventory-discovered');
	});
});
