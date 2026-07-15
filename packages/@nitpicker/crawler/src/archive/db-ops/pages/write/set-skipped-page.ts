import type { DB_Page } from '../../../types.js';
import type { Knex } from 'knex';

import { getIdByUrl } from '../../_shared/get-id-by-url.js';

/**
 * Marks a page as skipped in the database with the given reason.
 * Creates the page row if it does not already exist.
 * @param knex - Knex query builder connected to the archive DB.
 * @param url - The URL of the skipped page.
 * @param reason - The reason the page was skipped.
 * @param isExternal - Whether the page is on an external domain. Defaults to `false`.
 */
export async function setSkippedPage(
	knex: Knex,
	url: string,
	reason: string,
	isExternal = false,
): Promise<void> {
	const pageId = await getIdByUrl(knex, url, isExternal ? 1 : 0);
	await knex<DB_Page>('pages')
		.where('id', pageId)
		.update({
			scraped: 1,
			isExternal: isExternal ? 1 : 0,
			isSkipped: 1,
			skipReason: reason,
		});
}
