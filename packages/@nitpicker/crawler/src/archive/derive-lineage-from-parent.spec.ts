import { describe, expect, it } from 'vitest';

import { deriveLineageFromParent } from './derive-lineage-from-parent.js';

describe('deriveLineageFromParent', () => {
	it('returns `inventory-discovered` when the parent is `inventory-seed` (regardless of fallback)', () => {
		// Parent in the inventory chain → child also in the chain. The
		// fallback is irrelevant when the inventory branch fires.
		expect(deriveLineageFromParent('inventory-seed', 'crawled')).toBe(
			'inventory-discovered',
		);
		expect(deriveLineageFromParent('inventory-seed')).toBe('inventory-discovered');
	});

	it('returns `inventory-discovered` when the parent is `inventory-discovered` (transitive)', () => {
		// Lineage is transitive: a child of a transitively-reached
		// inventory node is still in the chain.
		expect(deriveLineageFromParent('inventory-discovered', 'crawled')).toBe(
			'inventory-discovered',
		);
		expect(deriveLineageFromParent('inventory-discovered')).toBe('inventory-discovered');
	});

	it('returns the `crawled` fallback when the parent is `crawled` (anchor / redirect call sites)', () => {
		// Anchor lineage and redirect chain intermediates both pass
		// `'crawled'` as fallback so the crawled-wins downgrade inside
		// `#getIdByUrl` fires on an existing `'inventory-*'` row.
		expect(deriveLineageFromParent('crawled', 'crawled')).toBe('crawled');
	});

	it('returns `undefined` fallback when the parent is `crawled` (sub-resource call site)', () => {
		// Sub-resource emit passes `undefined` so the DB DEFAULT
		// `'crawled'` lands on the freshly INSERTed resource row —
		// `setResources` is INSERT-only with `onConflict.ignore()` and
		// has no downgrade path to drive.
		expect(deriveLineageFromParent('crawled')).toBeUndefined();
	});

	it('returns the fallback when the parent is `undefined` (no parent row)', () => {
		// `undefined` means the caller could not resolve a parent —
		// treat as "outside the inventory chain", same as `'crawled'`.
		expect(deriveLineageFromParent(undefined, 'crawled')).toBe('crawled');
		expect(deriveLineageFromParent()).toBeUndefined();
	});
});
