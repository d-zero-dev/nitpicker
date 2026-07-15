import type { DB_Resource } from '../../types.js';
import type { Knex } from 'knex';

import { getIdByUrl } from '../_shared/get-id-by-url.js';

/**
 * Inserts a referrer relationship between a resource and a page into the
 * `resources-referrers` table. Silently skips if the resource is not found.
 * @param knex - Knex query builder connected to the archive DB.
 * @param src - The URL of the resource.
 * @param pageUrl - The URL of the page that references the resource.
 */
export async function insertResourceReferrers(
	knex: Knex,
	src: string,
	pageUrl: string,
): Promise<void> {
	const selected = await knex
		.select('id')
		.from<DB_Resource>('resources')
		.where('url', src);
	if (!selected[0]) {
		// Ignore when the resource is not found
		return;
	}
	const [{ id: resourceId }] = selected;
	const pageId = await getIdByUrl(knex, pageUrl);
	await knex('resources-referrers')
		.insert({
			resourceId,
			pageId,
		})
		.onConflict(['resourceId', 'pageId'])
		.ignore();
}
