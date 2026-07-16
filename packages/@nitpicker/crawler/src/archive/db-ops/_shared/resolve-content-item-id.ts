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
 * that later rolls back would point at ids that no longer exist. Every
 * write op that opens a multi-statement transaction around this function
 * must discard the whole cache bundle when that transaction fails,
 * before any retry — see the try/catch + `clearWriteRefCaches` wrappers
 * in `update-page.ts` and `record-redirect.ts`.
 *
 * **Race-condition safety.** The INSERT uses `ON CONFLICT(url_id) DO
 * UPDATE SET url_id = url_id RETURNING id, source` — the same no-op
 * -update idiom as `upsertUrlRef` — so when a concurrent transaction
 * wins the insert race, the statement still returns the existing row's
 * id and source in one round trip. `onConflict().ignore()` without
 * `RETURNING` must NOT be used here: knex's sqlite-family dialects
 * report the connection's stale `lastInsertRowid` for a conflict-ignored
 * insert, which reads as a valid id belonging to an unrelated row.
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
 * @throws {Error} When the upsert's `RETURNING` yields no row — should
 *   not happen, so it surfaces as a hard error.
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

	const insertedRows: { id: number; source: PageSource }[] = await qb.raw(
		`INSERT INTO content_items (url_id, scraped, is_target, is_external${source === undefined ? '' : ', source'})
		 VALUES (?, 0, 0, ?${source === undefined ? '' : ', ?'})
		 ON CONFLICT(url_id) DO UPDATE SET url_id = url_id
		 RETURNING id, source`,
		source === undefined ? [urlId, isExternal ?? 0] : [urlId, isExternal ?? 0, source],
	);
	const inserted = insertedRows[0];
	if (inserted === undefined) {
		throw new Error(`Failed to insert a new content item: ${url}`);
	}
	const insertedEntry: ContentItemCacheEntry = {
		id: inserted.id,
		source: inserted.source,
	};
	// A conflict means a concurrent writer created the row between this
	// function's SELECT miss and the INSERT — the returned `source` is that
	// row's value, so the downgrade must be evaluated exactly as on the
	// SELECT-hit path.
	await applyCrawledWinsDowngrade(qb, insertedEntry, source);
	caches.contentItems.set(url, insertedEntry);
	return insertedEntry.id;
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
