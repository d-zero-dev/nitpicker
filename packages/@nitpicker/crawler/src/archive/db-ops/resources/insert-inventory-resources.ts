import type { WriteRefCaches } from '../_shared/types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../utils/array/each-splitted.js';
import { resolveUrlRefs } from '../../populate-entity-tables/resolve-url-refs.js';
import { decomposeUrl } from '../../populate-ref-tables/decompose-url.js';

/**
 * Pre-insert inventory non-HTML URLs into `resource_items` as placeholder
 * rows with `source = 'inventory-seed'` and all metadata columns NULL —
 * the non-HTML counterpart of `insertInventorySeeds`. Used by
 * `CrawlerOrchestrator.inventory` so the ingestion phase commits all of
 * its non-HTML URLs in one chunked round-trip per 500 instead of N
 * sequential `insertResource` awaits — a per-URL loop would spend
 * minutes inside the `.bak`-protected window on a 50k-URL inventory
 * list, where the bulk path finishes in seconds.
 *
 * Idempotent: both the `url_refs` and `resource_items` inserts are
 * `ON CONFLICT ... IGNORE`, leaving existing rows untouched (the
 * orchestrator's `getExistingResourceUrls` filter is what keeps a
 * crawled-lineage `resource_items` row from being downgraded to the
 * inventory label here).
 *
 * Chunked at 500 to stay well under SQLite's `SQLITE_MAX_VARIABLE_NUMBER`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param caches
 * @param urls - URL strings (already in `withoutHashAndAuth` form).
 */
export async function insertInventoryResources(
	knex: Knex,
	caches: WriteRefCaches,
	urls: readonly string[],
): Promise<void> {
	if (urls.length === 0) {
		return;
	}
	await eachSplitted([...urls], 500, async (chunk) => {
		await knex('url_refs')
			.insert(chunk.map((url) => ({ url, ...decomposeUrl(url) })))
			.onConflict('url')
			.ignore();
		const urlIds = await resolveUrlRefs(knex, chunk);
		const rows = chunk.map((url) => {
			const urlId = urlIds.get(url);
			if (urlId === undefined) {
				throw new Error(`insertInventoryResources: url_refs.id not resolved for ${url}`);
			}
			caches.urlIds.set(url, urlId);
			return {
				url_id: urlId,
				is_external: 0,
				status: null,
				status_text: null,
				content_type_id: null,
				content_length: null,
				header_set_id: null,
				compress: 0,
				cdn: 0,
				source: 'inventory-seed',
			};
		});
		await knex('resource_items').insert(rows).onConflict('url_id').ignore();
		const inserted = (await knex
			.select('ri.id', 'ur.url')
			.from('resource_items as ri')
			.join('url_refs as ur', 'ur.id', 'ri.url_id')
			.whereIn('ur.url', chunk)) as { id: number; url: string }[];
		for (const row of inserted) {
			caches.resourceIds.set(row.url, row.id);
		}
	});
}
