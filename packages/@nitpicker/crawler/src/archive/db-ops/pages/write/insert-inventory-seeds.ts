import type { DB_Page, PageSource } from '../../../types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';

/**
 * Pre-insert inventory HTML seeds into `pages` as `scraped = 0`,
 * `source = 'inventory-seed'` placeholders so the URL's existence in the
 * archive is **durable before the scrape phase starts**.
 *
 * Why this is the linchpin of `--inventory` Ctrl+C tolerance: without
 * pre-insertion, HTML seeds live only in the Crawler's in-memory
 * `LinkList` until the dealer eventually calls `setPage`. A Ctrl+C /
 * crash before that point loses the seed without trace, and `--resume`
 * cannot recover it
 * because `getCrawlingState`'s strict pending set requires a `pages` row.
 * Pre-inserting fills exactly that gap: the strict pending set picks
 * these rows up via its `OR p.source != 'crawled'` clause, so
 * `--resume` after an interrupted inventory pass picks every seed back
 * up. See `getCrawlingState` for the strict-set rationale.
 *
 * Idempotent: `onConflict('url').ignore()` keeps existing rows intact.
 * The `getIdByUrl` crawled-wins downgrade still fires later when a
 * crawled-lineage anchor reaches one of these seeds — that's the right
 * behaviour (a seed that turned out to be reachable is not an orphan
 * and should not retain the inventory label).
 *
 * Chunked into 500-URL batches so SQLite's bound-parameter limit
 * (`SQLITE_MAX_VARIABLE_NUMBER`, default 999) cannot be hit even on a
 * tens-of-thousands inventory list.
 *
 * Called by `CrawlerOrchestrator.inventory` during the
 * `.bak`-protected ingestion phase, so any failure here aborts the run
 * and restores from backup — the operator reruns from scratch.
 * @param knex - Knex query builder connected to the archive DB.
 * @param urls - URL strings already in `withoutHashAndAuth` form.
 */
export async function insertInventorySeeds(
	knex: Knex,
	urls: readonly string[],
): Promise<void> {
	if (urls.length === 0) {
		return;
	}
	await eachSplitted([...urls], 500, async (chunk) => {
		await knex<DB_Page>('pages')
			.insert(
				chunk.map((url) => ({
					url,
					scraped: 0 as const,
					isExternal: 0 as const,
					isTarget: 0 as const,
					source: 'inventory-seed' as PageSource,
				})),
			)
			.onConflict('url')
			.ignore();
	});
}
