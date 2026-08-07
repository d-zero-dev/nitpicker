import type { WriteRefCaches } from '../../_shared/types.js';
import type { Knex } from 'knex';

import { insertInventoryContentItems } from './insert-inventory-content-items.js';

/**
 * Record exclude-matched inventory URLs into `content_items` as
 * `scraped = 1`, `is_skipped = 1`, `skip_reason = 'excluded'`,
 * `source = 'inventory-seed'` rows — the same terminal state the normal
 * crawl's fetch-time `shouldSkipUrl` gate produces via `setSkippedPage`
 * for link-discovered excluded URLs.
 *
 * Why a dedicated write path instead of routing these URLs through the
 * crawler's gate: non-HTML inventory URLs never enter the crawler at all
 * (they are recorded straight into `resources`), so the gate cannot see
 * them, and pre-inserting HTML seeds only to have the dealer skip them
 * wastes dealer slots for a verdict already known at ingestion time.
 * Writing the terminal skipped state directly keeps the invariant "the
 * same URL lands in the same archive state regardless of how it was
 * discovered (anchor vs inventory list)" for both classifications
 * (issue #260).
 *
 * `scraped = 1` is load-bearing: it keeps these rows out of
 * `getCrawlingState`'s strict pending set, so `--resume` after an
 * interrupted inventory pass does not try to fetch operator-excluded
 * URLs.
 *
 * Idempotent: both the `url_refs` and `content_items` inserts are
 * `ON CONFLICT ... IGNORE`, so an existing row — in particular a
 * previously crawled page that now matches the exclusion config — is
 * never downgraded to skipped by this path (crawled-wins). The
 * orchestrator additionally filters known URLs out before calling this,
 * so conflicts here are limited to within-list duplicates.
 *
 * Called by `CrawlerOrchestrator.inventory` during the `.bak`-protected
 * ingestion phase, so any failure here aborts the run and restores from
 * backup — the operator reruns from scratch. The chunking /
 * conflict-ignore / cache-population plumbing lives in
 * {@link insertInventoryContentItems}, shared with
 * `insertInventorySeeds`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param caches - The connection's write-side id caches.
 * @param urls - URL strings already in `withoutHashAndAuth` form.
 */
export async function insertInventorySkippedPages(
	knex: Knex,
	caches: WriteRefCaches,
	urls: readonly string[],
): Promise<void> {
	await insertInventoryContentItems({
		knex,
		caches,
		urls,
		row: {
			scraped: 1,
			is_external: 0,
			is_target: 0,
			is_skipped: 1,
			skip_reason: 'excluded',
			source: 'inventory-seed',
		},
		opName: 'insertInventorySkippedPages',
	});
}
