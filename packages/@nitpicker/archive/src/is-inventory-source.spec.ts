import { describe, expect, it } from 'vitest';

import { isInventorySource } from './is-inventory-source.js';

describe('isInventorySource', () => {
	it('returns true for `inventory-seed`', () => {
		// Explicit user-listed entry from a `--inventory` URL file.
		expect(isInventorySource('inventory-seed')).toBe(true);
	});

	it('returns true for `inventory-discovered`', () => {
		// Transitively reached through the inventory chain (anchor /
		// sub-resource / redirect intermediate originating from an
		// inventory-* row).
		expect(isInventorySource('inventory-discovered')).toBe(true);
	});

	it('returns false for `crawled`', () => {
		// The normal crawl graph baseline — NOT in the inventory chain.
		expect(isInventorySource('crawled')).toBe(false);
	});

	it('returns false for `undefined` (caller had no row to read)', () => {
		// Callers feed the raw `source` column value through this
		// predicate; a missing row in JS reads as `undefined` and must
		// be treated as "not in the inventory chain".
		expect(isInventorySource()).toBe(false);
	});
});
