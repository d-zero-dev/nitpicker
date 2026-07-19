import type { Knex } from 'knex';

import { eachSplitted } from '../../../utils/array/each-splitted.js';

/**
 * Return the subset of `urls` that already exist as `resource_items` rows.
 * See `getExistingPageUrls` — same chunking strategy.
 * @param knex - Knex query builder connected to the archive DB.
 * @param urls - URL strings to probe.
 * @returns URLs found among `resource_items`.
 */
export async function getExistingResourceUrls(
	knex: Knex,
	urls: readonly string[],
): Promise<string[]> {
	if (urls.length === 0) {
		return [];
	}
	const found: string[] = [];
	await eachSplitted([...urls], 500, async (chunk) => {
		const rows = await knex('resource_items')
			.join('url_refs', 'url_refs.id', 'resource_items.url_id')
			.select('url_refs.url as url')
			.whereIn('url_refs.url', chunk);
		for (const row of rows) {
			found.push(row.url);
		}
	});
	return found;
}
