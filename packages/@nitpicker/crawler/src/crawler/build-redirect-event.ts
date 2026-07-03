import type { CrawlerEventTypes, InventoryMode } from './types.js';
import type { PageData } from '../utils/types/types.js';

import { derivePageSource } from './derive-page-source.js';

/**
 * Build the payload for the {@link CrawlerEventTypes.redirect} event so the
 * `{ result, source }` shape is constructed in one place. Pure function —
 * no I/O, no side effects, just the wiring that connects
 * {@link derivePageSource} to the emit call.
 *
 * Exists so a unit test can pin the wiring directly. Before extraction
 * the assembly lived inline in `Crawler.#scrape`, which meant the only
 * way to catch "someone deletes the `source` field" or "someone passes
 * `inventoryMode` where it should pass `derivePageSource(...)`" was the
 * inventory E2E. Now a single-purpose spec exercises the construction.
 *
 * The originating URL passed in `pageUrlWithoutHashAndAuth` must be the
 * URL the redirect chain STARTS from (the page being scraped), not the
 * destination — see `Database.recordRedirect` JSDoc for why
 * lineage propagates from origin, not from the destination.
 * @param pageData - HEAD-resolved page data carrying the redirect chain.
 * @param inventoryMode - Inventory-mode config from `CrawlerOptions.inventoryMode`, or `null` outside `--inventory`.
 * @param pageUrlWithoutHashAndAuth - The originating page URL keyed by `withoutHashAndAuth`.
 * @returns The exact event payload to feed `emit('redirect', ...)`.
 */
export function buildRedirectEvent(
	pageData: PageData,
	inventoryMode: InventoryMode | null,
	pageUrlWithoutHashAndAuth: string,
): CrawlerEventTypes['redirect'] {
	return {
		result: pageData,
		source: derivePageSource(inventoryMode, pageUrlWithoutHashAndAuth),
	};
}
