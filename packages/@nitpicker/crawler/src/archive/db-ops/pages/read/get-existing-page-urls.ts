import type { DB_Page } from '../../../types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';

/**
 * Return the subset of `urls` that already exist in the `pages` table.
 * Chunked into batches so SQLite's `IN (?, ?, …)` parameter limit
 * (`SQLITE_MAX_VARIABLE_NUMBER`, default 999) cannot be hit even when the
 * inventory list contains tens of thousands of URLs.
 *
 * Read-only — no transaction, no lock contention with the crawler write
 * pipeline (callers run this BEFORE the `<archive>.bak` is taken and the
 * crawl is started).
 * @param knex - Knex query builder connected to the archive DB.
 * @param urls - URL strings to probe (already in `withoutHashAndAuth` form).
 * @returns URLs found in `pages`. Order is not preserved.
 */
export async function getExistingPageUrls(
	knex: Knex,
	urls: readonly string[],
): Promise<string[]> {
	if (urls.length === 0) {
		return [];
	}
	const found: string[] = [];
	await eachSplitted([...urls], 500, async (chunk) => {
		const rows = await knex.select('url').from<DB_Page>('pages').whereIn('url', chunk);
		for (const row of rows) {
			found.push(row.url);
		}
	});
	return found;
}
