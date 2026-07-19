import type { WriteRefCaches } from '../../_shared/types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';
import { resolveUrlRefs } from '../../../populate-entity-tables/resolve-url-refs.js';
import { decomposeUrl } from '../../../populate-ref-tables/decompose-url.js';

/**
 * Pre-insert inventory HTML seeds into `content_items` as `scraped = 0`,
 * `source = 'inventory-seed'` placeholders so the URL's existence in the
 * archive is **durable before the scrape phase starts**.
 *
 * Why this is the linchpin of `--inventory` Ctrl+C tolerance: without
 * pre-insertion, HTML seeds live only in the Crawler's in-memory
 * `LinkList` until the dealer eventually calls `setPage`. A Ctrl+C /
 * crash before that point loses the seed without trace, and `--resume`
 * cannot recover it because `getCrawlingState`'s strict pending set
 * requires a `content_items` row. Pre-inserting fills exactly that gap:
 * the strict pending set picks these rows up via its
 * `OR source != 'crawled'` clause, so `--resume` after an interrupted
 * inventory pass picks every seed back up. See `getCrawlingState` for
 * the strict-set rationale.
 *
 * Idempotent: both the `url_refs` and `content_items` inserts are
 * `ON CONFLICT ... IGNORE`, keeping existing rows intact. The
 * `resolveContentItemId` crawled-wins downgrade still fires later when a
 * crawled-lineage anchor reaches one of these seeds — that's the right
 * behaviour (a seed that turned out to be reachable is not an orphan
 * and should not retain the inventory label).
 *
 * Chunked into 500-URL batches so SQLite's bound-parameter limit
 * (`SQLITE_MAX_VARIABLE_NUMBER`) cannot be hit even on a
 * tens-of-thousands inventory list.
 *
 * Called by `CrawlerOrchestrator.inventory` during the
 * `.bak`-protected ingestion phase, so any failure here aborts the run
 * and restores from backup — the operator reruns from scratch.
 * @param knex - Knex query builder connected to the archive DB.
 * @param caches
 * @param urls - URL strings already in `withoutHashAndAuth` form.
 */
export async function insertInventorySeeds(
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
				throw new Error(`insertInventorySeeds: url_refs.id not resolved for ${url}`);
			}
			caches.urlIds.set(url, urlId);
			return {
				url_id: urlId,
				scraped: 0,
				is_external: 0,
				is_target: 0,
				source: 'inventory-seed',
			};
		});
		await knex('content_items').insert(rows).onConflict('url_id').ignore();
		const inserted = (await knex
			.select('ci.id', 'ci.source', 'ur.url')
			.from('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.whereIn('ur.url', chunk)) as {
			id: number;
			source: 'inventory-seed';
			url: string;
		}[];
		for (const row of inserted) {
			caches.contentItems.set(row.url, { id: row.id, source: row.source });
		}
	});
}
