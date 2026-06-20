import type { PageSource } from '../archive/types.js';

/**
 * Decide which {@link PageSource} label a newly-captured sub-resource row
 * (CSS / JS / image / fetch response) should carry, based on the lineage of
 * the page that is currently being rendered.
 *
 * Sub-resources are NEVER themselves seeds — even when puppeteer is
 * rendering a page that *is* an inventory seed, the assets it pulls in are
 * downstream and must be labelled `'inventory-discovered'`. The seed label
 * is reserved for URLs that were explicitly handed in by the user via the
 * `--inventory` file. Likewise, when a sub-resource is captured during a
 * render of an `'inventory-discovered'` page (a page reached transitively
 * through the inventory chain), the asset is still inventory-discovered —
 * not a new seed.
 *
 * Outside the inventory chain (parent is `'crawled'` or has no source
 * record) this returns `undefined` so the caller emits no `source` and the
 * DB DEFAULT (`'crawled'`) lands on the row, leaving the normal crawl path
 * untouched.
 *
 * `parentSource` must reflect the MERGED source of the page being scraped:
 * for an active `--inventory` session that comes from
 * {@link import('./derive-page-source.js').derivePageSource}, for a
 * `--resume` / `--retry-failed` session it comes from a DB lookup
 * (`PageSourceLookup`) because `inventoryMode` is not persisted across
 * sessions. The two-stage resolution is what keeps sub-resource labels
 * correct on resume: even though the orchestrator no longer carries the
 * inventory seed set in memory, the DB still records the parent's lineage
 * and we propagate it forward.
 * @param parentSource - Merged source of the page that is producing this sub-resource (or `undefined` for an unknown / `'crawled'` parent).
 * @returns The label to write to `resources.source`, or `undefined` for the DB default.
 */
export function deriveResourceSource(
	parentSource: PageSource | undefined,
): PageSource | undefined {
	if (parentSource === 'inventory-seed' || parentSource === 'inventory-discovered') {
		return 'inventory-discovered';
	}
	return undefined;
}
