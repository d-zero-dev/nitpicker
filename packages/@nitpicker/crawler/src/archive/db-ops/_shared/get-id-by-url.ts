import type { DB_Page, PageSource } from '../../types.js';
import type { Knex } from 'knex';

/**
 * Returns the `pages.id` for `url`, inserting a placeholder row when the
 * URL is not yet known. Foundational identity primitive shared by every
 * op that needs to record an edge or lookup to a URL (see the callers
 * under `pages/write/`, `resources/insert-resource-referrers.ts`, and
 * `errors/insert-page-error.ts`).
 *
 * **Source semantics.** `source` is written ONLY on the INSERT path —
 * when the row already exists, we never reach the INSERT and the
 * existing row's `source` stays untouched. This is what keeps a second
 * `crawl --inventory` from "demoting" a page that was first labelled
 * `'inventory-seed'` back to `'inventory-discovered'` on later passes.
 *
 * **Crawled-wins downgrade.** When a row that was previously labelled
 * `'inventory-seed'` or `'inventory-discovered'` is re-encountered via a
 * `'crawled'`-lineage anchor (the parent page is part of the graph
 * reachable from the original crawl roots), downgrade the row to
 * `'crawled'`. The inventory goal is finding orphans — anything reachable
 * from the crawled chain is NOT an orphan and should not retain an
 * inventory label.
 *
 * **Race-condition safety.** `onConflict('url').ignore()` returns 0 rows
 * inserted when a concurrent transaction won the race. In that case we
 * re-SELECT the row to recover its id rather than throw.
 * @param qb - Knex instance OR a transaction, used verbatim for both
 *   the initial SELECT and any INSERT / UPDATE the function issues. Pass
 *   a `trx` when the caller is running inside a transaction so the read
 *   sees uncommitted writes from that same transaction; otherwise pass
 *   the base Knex instance. Callers must resolve `trx ?? knex` before
 *   calling — the fallback logic that used to live inside the class-level
 *   `#getIdByUrl` (`const qb = trx ?? this.#instance`) is now the
 *   caller's responsibility so `getIdByUrl` stays a pure function of its
 *   arguments.
 * @param url - The URL to look up or insert.
 * @param isExternal - Optional; recorded on new inserts only. `1` marks
 *   the row as an external URL that will never be scraped as a target.
 * @param source - Optional provenance label put on a newly-inserted row.
 *   Omit to let the `pages.source` DEFAULT (`'crawled'`) apply.
 * @returns The `pages.id` of the existing or newly inserted row.
 * @throws When `onConflict.ignore()` returns 0 rows and the follow-up
 *   SELECT also fails to locate the URL — should not happen under
 *   normal race conditions, so it surfaces as a hard error.
 */
export async function getIdByUrl(
	qb: Knex | Knex.Transaction,
	url: string,
	isExternal?: 0 | 1,
	source?: PageSource,
): Promise<number> {
	const [record] = await qb
		.select('id', 'source')
		.from<DB_Page>('pages')
		.where('url', url);
	// Must use `?` because it may be `undefined`
	const pageId = record?.id ?? Number.NaN;
	if (Number.isFinite(pageId)) {
		if (source === 'crawled' && record?.source && record.source !== 'crawled') {
			await qb<DB_Page>('pages').where('id', pageId).update({ source: 'crawled' });
		}
		return pageId;
	}
	const insertedRows = await qb<DB_Page>('pages')
		.insert({
			url,
			scraped: 0,
			isTarget: 0,
			...(isExternal != null && { isExternal }),
			...(source === undefined ? {} : { source }),
		})
		.onConflict('url')
		.ignore();
	const [insertedId] = insertedRows;
	if (!insertedId) {
		// onConflict.ignore() returns 0 on race condition — re-select
		const [existing] = await qb.select('id').from<DB_Page>('pages').where('url', url);
		if (existing?.id) {
			return existing.id;
		}
		throw new Error(`Failed to insert a new page: ${url}`);
	}
	return insertedId;
}
