import type { DB_Resource, PageSource } from '../../types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../utils/array/each-splitted.js';

/**
 * Pre-insert inventory non-HTML URLs into `resources` as placeholder rows
 * with `source = 'inventory-seed'` and all metadata columns NULL — the
 * non-HTML counterpart of `insertInventorySeeds`. Used by
 * `CrawlerOrchestrator.inventory` so the ingestion phase commits all of
 * its non-HTML URLs in one chunked round-trip per 500 instead of N
 * sequential `insertResource` awaits — a per-URL loop would spend
 * minutes inside the `.bak`-protected window on a 50k-URL inventory
 * list, where the bulk path finishes in seconds.
 *
 * Idempotent: `onConflict('url').ignore()` leaves existing rows untouched
 * (the orchestrator's `getExistingResourceUrls` filter is what keeps a
 * crawled-lineage `resources` row from being downgraded to the
 * inventory label here).
 *
 * Chunked at 500 to stay well under SQLite's `SQLITE_MAX_VARIABLE_NUMBER`
 * (default 999) — every row binds the URL plus the `responseHeaders`
 * JSON null, so the per-chunk bound budget is well within limits.
 * @param knex - Knex query builder connected to the archive DB.
 * @param urls - URL strings (already in `withoutHashAndAuth` form).
 */
export async function insertInventoryResources(
	knex: Knex,
	urls: readonly string[],
): Promise<void> {
	if (urls.length === 0) {
		return;
	}
	await eachSplitted([...urls], 500, async (chunk) => {
		await knex<DB_Resource>('resources')
			.insert(
				chunk.map((url) => ({
					url,
					isExternal: 0 as const,
					status: null,
					statusText: null,
					contentType: null,
					contentLength: null,
					compress: 0 as const,
					cdn: 0 as const,
					responseHeaders: null,
					source: 'inventory-seed' as PageSource,
				})),
			)
			.onConflict('url')
			.ignore();
	});
}
