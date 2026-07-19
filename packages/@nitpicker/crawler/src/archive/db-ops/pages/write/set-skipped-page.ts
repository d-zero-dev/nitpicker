import type { WriteRefCaches } from '../../_shared/types.js';
import type { Knex } from 'knex';

import { resolveContentItemId } from '../../_shared/resolve-content-item-id.js';

/**
 * Marks a page as skipped in the database with the given reason.
 * Creates the `content_items` row (with its `url_refs` entry) if it does
 * not already exist.
 * @param knex - Knex query builder connected to the archive DB.
 * @param caches - The connection's write-side id caches.
 * @param url - The URL of the skipped page.
 * @param reason - The reason the page was skipped.
 * @param isExternal - Whether the page is on an external domain. Defaults to `false`.
 */
export async function setSkippedPage(
	knex: Knex,
	caches: WriteRefCaches,
	url: string,
	reason: string,
	isExternal = false,
): Promise<void> {
	const pageId = await resolveContentItemId(knex, caches, url, isExternal ? 1 : 0);
	await knex('content_items')
		.where('id', pageId)
		.update({
			scraped: 1,
			is_external: isExternal ? 1 : 0,
			is_skipped: 1,
			skip_reason: reason,
		});
}
