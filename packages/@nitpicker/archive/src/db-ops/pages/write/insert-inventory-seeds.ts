import type { WriteRefCaches } from '../../_shared/types.js';
import type { Knex } from 'knex';

import { insertInventoryContentItems } from './insert-inventory-content-items.js';

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
 * Called by `CrawlerOrchestrator.inventory` during the
 * `.bak`-protected ingestion phase, so any failure here aborts the run
 * and restores from backup — the operator reruns from scratch. The
 * chunking / conflict-ignore / cache-population plumbing lives in
 * {@link insertInventoryContentItems}, shared with
 * `insertInventorySkippedPages`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param caches - The connection's write-side id caches.
 * @param urls - URL strings already in `withoutHashAndAuth` form.
 */
export async function insertInventorySeeds(
	knex: Knex,
	caches: WriteRefCaches,
	urls: readonly string[],
): Promise<void> {
	await insertInventoryContentItems({
		knex,
		caches,
		urls,
		row: {
			scraped: 0,
			is_external: 0,
			is_target: 0,
			source: 'inventory-seed',
		},
		opName: 'insertInventorySeeds',
	});
}
