import type { InventoryMode } from './types.js';
import type { PageData } from '../utils/types/types.js';

import { describe, expect, it } from 'vitest';

import { buildRedirectEvent } from './build-redirect-event.js';

/**
 * Build a minimal PageData stand-in. The builder treats the value as
 * opaque — only the wiring contract is under test, so a `{} as PageData`
 * cast is sufficient.
 * @returns Cast empty object usable as a PageData reference.
 */
const dummyPageData = (): PageData => ({}) as unknown as PageData;

describe('buildRedirectEvent', () => {
	it('returns a payload with `result` aliased to the input `pageData` (no clone)', () => {
		// The orchestrator forwards `result` straight to `Archive.setRedirect`
		// without re-reading any field, so identity equality is the
		// expected contract — a regression that clones or wraps the
		// payload would change the assertion at runtime.
		const pageData = dummyPageData();
		const event = buildRedirectEvent(pageData, null, 'https://example.com/');
		expect(event.result).toBe(pageData);
	});

	it('emits `source: undefined` when inventoryMode is null (resume / normal crawl)', () => {
		// `inventoryMode === null` is the non-inventory branch of
		// `derivePageSource`, which yields `undefined`. The DB DEFAULT
		// `'crawled'` then lands on the row downstream.
		const event = buildRedirectEvent(
			dummyPageData(),
			null,
			'https://example.com/anywhere',
		);
		expect(event.source).toBeUndefined();
	});

	it('emits `source: "inventory-seed"` when the originating URL is a seed', () => {
		// URL is in the seed set → `derivePageSource` returns
		// `'inventory-seed'`. The redirect-edge call path forwards this
		// to `recordRedirect`, which uses it to set the destination
		// row's lineage AND to drive `chainLineageSource` for
		// intermediates.
		const inventoryMode: InventoryMode = {
			seedUrls: new Set(['https://example.com/seed/']),
		};
		const event = buildRedirectEvent(
			dummyPageData(),
			inventoryMode,
			'https://example.com/seed/',
		);
		expect(event.source).toBe('inventory-seed');
	});

	it('emits `source: "inventory-discovered"` when inventoryMode is active but the URL is not a seed', () => {
		// URL is reached transitively (anchor or sub-resource emit) —
		// `derivePageSource` returns the discovered label.
		const inventoryMode: InventoryMode = {
			seedUrls: new Set(['https://example.com/seed/']),
		};
		const event = buildRedirectEvent(
			dummyPageData(),
			inventoryMode,
			'https://example.com/non-seed/',
		);
		expect(event.source).toBe('inventory-discovered');
	});

	it('uses the `pageUrlWithoutHashAndAuth` parameter as the seed-set lookup key (not the PageData URL)', () => {
		// Regression guard: a tempting refactor would read the URL off
		// the PageData object instead of the explicit parameter. That
		// would couple the builder to PageData's URL shape (which
		// already strips hash / credentials at a different layer) and
		// silently change the lookup key. Pin the parameter as the
		// authoritative source.
		const inventoryMode: InventoryMode = {
			seedUrls: new Set(['https://example.com/seed/']),
		};
		const event = buildRedirectEvent(
			dummyPageData(),
			inventoryMode,
			'https://example.com/seed/',
		);
		expect(event.source).toBe('inventory-seed');
	});
});
