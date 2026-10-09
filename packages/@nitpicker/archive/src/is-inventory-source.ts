import type { PageSource } from './types.js';

/**
 * Predicate that returns `true` when the given page source value belongs to
 * the inventory chain — i.e. it is one of the `'inventory-*'` variants of
 * {@link PageSource}.
 *
 * Centralises the membership check that decides whether lineage
 * propagation should fire. Three call sites used to inline
 * `s === 'inventory-seed' || s === 'inventory-discovered'`, which is both
 * a DRY violation AND a future-proofing trap: when a new inventory-family
 * label gets added (e.g. `'inventory-promoted'`), every inlined check has
 * to be located and updated by hand. Routing through this predicate
 * keeps the membership rule in one place.
 *
 * Returns `false` for `undefined` so callers can pass the raw `source`
 * column value (which is non-NULL in the DB schema but reads as
 * `undefined` from a missing row in JS) without a separate null check.
 * @param source - The source value to test, or `undefined` when no row matched.
 * @returns `true` if the source is in the inventory chain, `false` otherwise.
 */
export function isInventorySource(source: PageSource | undefined): boolean {
	return source === 'inventory-seed' || source === 'inventory-discovered';
}
