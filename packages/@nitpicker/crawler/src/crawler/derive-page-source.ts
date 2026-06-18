import type { InventoryMode } from './types.js';
import type { PageSource } from '../archive/types.js';

/**
 * Decide which {@link PageSource} label a newly-scraped page row should carry.
 *
 * When the crawler is NOT in inventory mode (`inventoryMode === null`),
 * returns `undefined` — the caller emits no `source` and the DB DEFAULT
 * `'crawled'` ends up on the row. This keeps the normal crawl path
 * untouched.
 *
 * When inventory mode is active, the URL is matched against
 * `inventoryMode.seedUrls`. A hit means the URL came straight from the
 * user-supplied list (`'inventory-seed'`); a miss means the URL was found
 * by following links from a seed page (`'inventory-discovered'`).
 *
 * Sub-resources captured by puppeteer during inventory-mode rendering are
 * NEVER seeds — the caller for those events always passes
 * `'inventory-discovered'` directly without consulting this helper.
 * @param inventoryMode - Inventory-mode config from `CrawlerOptions.inventoryMode`, or `null` outside `--inventory`.
 * @param pageUrlWithoutHashAndAuth - The page URL keyed by `withoutHashAndAuth` (auth credentials stripped, hash dropped).
 * @returns The label to write to `pages.source`, or `undefined` for the DB default.
 */
export function derivePageSource(
	inventoryMode: InventoryMode | null,
	pageUrlWithoutHashAndAuth: string,
): PageSource | undefined {
	if (inventoryMode === null) {
		return undefined;
	}
	return inventoryMode.seedUrls.has(pageUrlWithoutHashAndAuth)
		? 'inventory-seed'
		: 'inventory-discovered';
}
