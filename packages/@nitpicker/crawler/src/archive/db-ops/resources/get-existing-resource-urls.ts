import type { DB_Resource } from '../../types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../utils/array/each-splitted.js';

/**
 * Return the subset of `urls` that already exist in the `resources` table.
 * See `getExistingPageUrls` — same chunking strategy.
 * @param knex - Knex query builder connected to the archive DB.
 * @param urls - URL strings to probe.
 * @returns URLs found in `resources`.
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
		const rows = await knex
			.select('url')
			.from<DB_Resource>('resources')
			.whereIn('url', chunk);
		for (const row of rows) {
			found.push(row.url);
		}
	});
	return found;
}
