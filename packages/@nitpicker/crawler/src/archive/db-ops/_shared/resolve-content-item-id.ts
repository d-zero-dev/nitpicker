import type { ContentItemCacheEntry, WriteRefCaches } from './types.js';
import type { PageSource } from '../../types.js';
import type { Knex } from 'knex';

import { upsertUrlRef } from './upsert-url-ref.js';

/**
 * Returns the `content_items.id` for `url`, inserting a placeholder row
 * (via `url_refs`) when the URL is not yet known. Foundational identity
 * primitive shared by every op that needs to record an edge or lookup to
 * a URL — the `content_items` successor of the legacy `pages.id`
 * resolver.
 *
 * **Source semantics.** `source` is written ONLY on the INSERT path —
 * when the row already exists, the INSERT is never reached and the
 * existing row's `source` stays untouched. This is what keeps a second
 * `crawl --inventory` from "demoting" a page that was first labelled
 * `'inventory-seed'` back to `'inventory-discovered'` on later passes.
 *
 * **Crawled-wins downgrade.** When a row that was previously labelled
 * `'inventory-seed'` or `'inventory-discovered'` is re-encountered via a
 * `'crawled'`-lineage anchor (the parent page is part of the graph
 * reachable from the original crawl roots), the row is downgraded to
 * `'crawled'`. The inventory goal is finding orphans — anything reachable
 * from the crawled chain is NOT an orphan and should not retain an
 * inventory label. The cached `source` is updated in the same step so a
 * later hit does not re-issue the UPDATE.
 *
 * **Cache poisoning on rollback.** Entries cached inside a transaction
 * that later rolls back would point at ids that no longer exist. The
 * owner of the cache bundle (the `Database` instance) discards the whole
 * bundle when a write transaction fails, before any retry — see
 * `Database.updatePage` / `Database.recordRedirect`.
 *
 * **Race-condition safety.** `onConflict('url_id').ignore()` returns 0
 * rows inserted when a concurrent transaction won the race. In that case
 * the row is re-SELECTed to recover its id rather than throw.
 * @param qb - Knex instance OR a transaction, used verbatim for every
 *   statement this function issues. Pass the `trx` when running inside a
 *   transaction so reads see uncommitted writes from that transaction.
 * @param caches - The connection's write-side id caches; mutated in place.
 * @param url - The URL to look up or insert (normalised
 *   `withoutHashAndAuth` form, matching the legacy identity contract).
 * @param isExternal - Optional; recorded on new inserts only. `1` marks
 *   the row as an external URL that will never be scraped as a target.
 *   Defaults to `0` (in-scope) on insert, mirroring the legacy column
 *   default.
 * @param source - Optional provenance label put on a newly-inserted row.
 *   Omit to let the `content_items.source` DEFAULT (`'crawled'`) apply.
 *   Pass `'crawled'` to arm the crawled-wins downgrade on existing
 *   inventory-labelled rows.
 * @returns The `content_items.id` of the existing or newly inserted row.
 * @throws When `onConflict.ignore()` inserts 0 rows and the follow-up
 *   SELECT also fails to locate the URL — should not happen, so it
 *   surfaces as a hard error.
 * @example
 * const pageId = await resolveContentItemId(trx, caches, anchor.href, 1, 'crawled');
 */
export async function resolveContentItemId(
	qb: Knex | Knex.Transaction,
	caches: WriteRefCaches,
	url: string,
	isExternal?: 0 | 1,
	source?: PageSource,
): Promise<number> {
	const cached = caches.contentItems.get(url);
	if (cached !== undefined) {
		await applyCrawledWinsDowngrade(qb, cached, source);
		return cached.id;
	}

	const urlId = await upsertUrlRef(qb, caches, url);
	const [record] = (await qb
		.select('id', 'source')
		.from('content_items')
		.where('url_id', urlId)) as { id: number; source: PageSource }[];
	if (record !== undefined) {
		const entry: ContentItemCacheEntry = { id: record.id, source: record.source };
		await applyCrawledWinsDowngrade(qb, entry, source);
		caches.contentItems.set(url, entry);
		return entry.id;
	}

	const insertedRows = await qb('content_items')
		.insert({
			url_id: urlId,
			scraped: 0,
			is_target: 0,
			is_external: isExternal ?? 0,
			...(source === undefined ? {} : { source }),
		})
		.onConflict('url_id')
		.ignore();
	const [insertedId] = insertedRows;
	if (!insertedId) {
		// onConflict.ignore() returns 0 on race condition — re-select
		const [existing] = (await qb
			.select('id', 'source')
			.from('content_items')
			.where('url_id', urlId)) as { id: number; source: PageSource }[];
		if (existing?.id) {
			caches.contentItems.set(url, { id: existing.id, source: existing.source });
			return existing.id;
		}
		throw new Error(`Failed to insert a new content item: ${url}`);
	}
	caches.contentItems.set(url, { id: insertedId, source: source ?? 'crawled' });
	return insertedId;
}

/**
 * Fires the crawled-wins downgrade when a `'crawled'`-lineage resolution
 * lands on a row whose last-known `source` is an inventory label, and
 * keeps the cache entry in sync so the UPDATE runs at most once per
 * (connection, row).
 * @param qb - Knex instance or transaction.
 * @param entry - The cached identity to check and mutate.
 * @param source - The resolution's lineage label.
 */
async function applyCrawledWinsDowngrade(
	qb: Knex | Knex.Transaction,
	entry: ContentItemCacheEntry,
	source: PageSource | undefined,
): Promise<void> {
	if (source !== 'crawled' || entry.source === 'crawled') {
		return;
	}
	await qb('content_items').where('id', entry.id).update({ source: 'crawled' });
	entry.source = 'crawled';
}
