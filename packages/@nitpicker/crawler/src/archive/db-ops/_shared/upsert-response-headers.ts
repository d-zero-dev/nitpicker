import type { WriteRefCaches } from './types.js';
import type { Knex } from 'knex';

import { createHeaderTableCaches } from '../../populate-ref-tables/create-header-table-caches.js';
import { decomposeHeaderSet } from '../../populate-ref-tables/decompose-header-set.js';
import { upsertOneHeaderSet } from '../../populate-ref-tables/upsert-one-header-set.js';

/**
 * Decomposes one response's headers and upserts them into the header
 * dictionary tables (`header_name_refs` / `header_value_refs` /
 * `header_sets` / `header_set_entries` / `header_flags`), returning the
 * `header_sets.id` to store on the referring `content_items` /
 * `resource_items` row.
 *
 * Runs per response (incrementally during the crawl), not deferred to
 * crawl-end — the header dictionaries grow as pages arrive and the
 * entity row can reference its `header_set_id` in the same write.
 * Dedup makes the steady-state cost small: CDN-served sites reuse a
 * handful of header shapes, so after the first few pages most calls
 * resolve entirely from the in-process caches (warmed lazily from the DB
 * on the first call, so a crawl that never sees headers pays nothing).
 *
 * Returns `null` for responses with no headers (`null` / `{}` /
 * unparsable) — the referring row stores `header_set_id = null`, which
 * is exactly how such rows read back through `header_flags` joins
 * (absent flags row = no headers recorded).
 * @param qb - Knex instance or transaction connected to the archive DB.
 * @param caches - The connection's write-side id caches; the header
 *   sub-caches are created and attached on first use.
 * @param responseHeaders - The response's header record as delivered by
 *   the scraper (`Record<name, string | string[]>`), or `null` /
 *   `undefined` when the response carried none.
 * @returns The `header_sets.id`, or `null` when there is no set to store.
 * @example
 * const headerSetId = await upsertResponseHeaders(knex, caches, {
 *   'content-type': 'text/html',
 *   'cache-control': 'no-store',
 * });
 */
export async function upsertResponseHeaders(
	qb: Knex | Knex.Transaction,
	caches: WriteRefCaches,
	responseHeaders: Record<string, string | string[] | undefined> | null | undefined,
): Promise<number | null> {
	// Serialise exactly like the scraper's own JSON storage form so the
	// decomposition (and its raw_json_hash dedup key) matches what a bulk
	// archive populate would compute for the same response.
	const rawJson = responseHeaders == null ? null : JSON.stringify(responseHeaders);
	const decomposed = decomposeHeaderSet(rawJson);
	if (decomposed === null) {
		return null;
	}
	if (caches.headers === null) {
		caches.headers = await createHeaderTableCaches(qb);
	}
	return await upsertOneHeaderSet(qb, decomposed, caches.headers);
}
