import type { InventoryMode } from './types.js';
import type { PageSource } from '../archive/types.js';

/**
 * Decide which {@link PageSource} label a newly-captured sub-resource row
 * (CSS / JS / image / fetch response) should carry.
 *
 * Sub-resources are NEVER themselves seeds — even when puppeteer is
 * rendering a page that *is* an inventory seed, the assets it pulls in
 * are downstream and must be labelled `'inventory-discovered'`. The seed
 * label is reserved for URLs that were explicitly handed in by the user
 * via the `--inventory` file.
 *
 * Outside inventory mode (`inventoryMode === null`) this returns
 * `undefined` so the caller emits no `source` and the DB DEFAULT
 * (`'crawled'`) lands on the row — keeps the normal crawl path
 * untouched. This is the sub-resource counterpart of
 * {@link import('./derive-page-source.js').derivePageSource}; the two
 * helpers exist as a pair so a future addition to {@link PageSource}
 * forces a parallel update.
 * @param inventoryMode - Inventory-mode config from `CrawlerOptions.inventoryMode`, or `null` outside `--inventory`.
 * @returns The label to write to `resources.source`, or `undefined` for the DB default.
 */
export function deriveResourceSource(
	inventoryMode: InventoryMode | null,
): PageSource | undefined {
	if (inventoryMode === null) {
		return undefined;
	}
	return 'inventory-discovered';
}
