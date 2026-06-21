import type { PageSource } from './types.js';

import { isInventorySource } from './is-inventory-source.js';

/**
 * Decide which {@link PageSource} label a child row reached through the
 * crawl graph (anchor placeholder, sub-resource, redirect chain
 * intermediate) should inherit from its parent.
 *
 * Two simple rules, expressed once so anchor / redirect / sub-resource
 * call sites stay in lockstep:
 *
 * 1. If the parent is in the inventory chain
 *    ({@link isInventorySource}) → propagate
 *    `'inventory-discovered'`. The child is itself a transitively
 *    reached node in the inventory chain; it is NOT a new seed (the
 *    seed label is reserved for URLs the operator listed in
 *    `--inventory ./list.txt`).
 *
 * 2. Otherwise → return `fallback`. The two production fallbacks differ
 *    by call site:
 *
 *    - Anchor lineage passes `'crawled'` explicitly so the crawled-wins
 *      downgrade inside `#getIdByUrl` fires when the anchor reaches an
 *      existing `'inventory-*'` row.
 *    - Sub-resource emit passes `undefined` so the DB DEFAULT
 *      `'crawled'` lands on the freshly INSERTed `resources` row (the
 *      `setResources` path is INSERT-only with `onConflict.ignore()`, so
 *      no downgrade is needed).
 *    - Redirect chain intermediate uses `'crawled'` (same reason as
 *      anchor): an existing inventory-* intermediate reached by a
 *      crawled redirect chain must be downgraded.
 *
 * Pure function — keeps the lineage decision testable in isolation from
 * the database transaction / event-emitter wiring that consumes it.
 * @param parentSource - The parent page's stored `source` column (or `undefined` when no parent row exists).
 * @param fallback - The label to return when the parent is NOT in the inventory chain. Pass `'crawled'` to enable the crawled-wins downgrade, or `undefined` to let the DB DEFAULT apply.
 * @returns The lineage label to attach to the child row.
 */
export function deriveLineageFromParent(
	parentSource: PageSource | undefined,
	fallback: PageSource | undefined,
): PageSource | undefined {
	if (isInventorySource(parentSource)) {
		return 'inventory-discovered';
	}
	return fallback;
}
