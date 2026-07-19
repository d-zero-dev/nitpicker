import type { WriteRefCaches } from '../_shared/types.js';
import type { Knex } from 'knex';

import { resolveContentItemId } from '../_shared/resolve-content-item-id.js';

/**
 * Records a partial scrape failure against the page identified by `url`.
 *
 * The page row is resolved (or inserted as a stub) via
 * {@link resolveContentItemId} so the error can be recorded even before
 * `setPage` has run — useful when the failure fires during scraping
 * (e.g. mid-`scrapeStart`) and the orchestrator enqueues this write
 * before the success write for the same URL.
 *
 * A single page can have multiple `page_errors` rows (e.g. both
 * `desktop-compact` and `mobile-small` viewports failing).
 * @param knex - Knex query builder connected to the archive DB.
 * @param caches - The connection's write-side id caches.
 * @param url - URL of the page being scraped.
 * @param phase - Scrape phase name (typically `'retryExhausted'`).
 * @param message - Human-readable failure message.
 * @param isExternal - Whether the URL is external. Defaults to `false`.
 */
export async function insertPageError(
	knex: Knex,
	caches: WriteRefCaches,
	url: string,
	phase: string,
	message: string,
	isExternal = false,
): Promise<void> {
	const pageId = await resolveContentItemId(knex, caches, url, isExternal ? 1 : 0);
	await knex('page_errors').insert({
		pageId,
		phase,
		message,
		createdAt: Date.now(),
	});
}
