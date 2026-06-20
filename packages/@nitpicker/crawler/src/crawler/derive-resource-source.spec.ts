import { describe, expect, it } from 'vitest';

import { deriveResourceSource } from './derive-resource-source.js';

describe('deriveResourceSource', () => {
	it('returns undefined when the parent is `undefined` (no lineage signal)', () => {
		// Either the parent page has not been recorded yet, or it lives outside
		// the inventory chain — both cases must leave sub-resources at the DB
		// DEFAULT `'crawled'`, NOT silently upgrade them.
		expect(deriveResourceSource()).toBeUndefined();
	});

	it('returns undefined when the parent is `crawled`', () => {
		// Crawled parents are part of the normal crawl graph — their
		// sub-resources are also `crawled` (default), never inventory.
		expect(deriveResourceSource('crawled')).toBeUndefined();
	});

	it('returns `inventory-discovered` when the parent is `inventory-seed`', () => {
		// A sub-resource captured while rendering an explicitly-listed
		// inventory seed inherits its lineage, but is itself a transitively
		// reached asset — `inventory-discovered`, never `inventory-seed`.
		expect(deriveResourceSource('inventory-seed')).toBe('inventory-discovered');
	});

	it('returns `inventory-discovered` when the parent is `inventory-discovered`', () => {
		// Lineage is transitive: a sub-resource of an already-inventory-discovered
		// page is still in the inventory chain.
		expect(deriveResourceSource('inventory-discovered')).toBe('inventory-discovered');
	});
});
