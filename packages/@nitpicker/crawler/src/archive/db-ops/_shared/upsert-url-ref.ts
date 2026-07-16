import type { WriteRefCaches } from './types.js';
import type { Knex } from 'knex';

import { decomposeUrl } from '../../populate-ref-tables/decompose-url.js';

/**
 * Resolves the `url_refs.id` for one URL string, inserting the row (with
 * its decomposed `scheme` / `host` / `port` / `path` / `query_hash` /
 * `fragment` columns) when the URL is not yet in the dictionary.
 *
 * The write path calls this for every URL it touches — page identities,
 * anchor hrefs, image `src` / `currentSrc`, resource URLs, and URL-shaped
 * meta columns — so the result is cached in `caches.urlIds` and a cache
 * hit issues no SQL at all. Anchor hrefs and CDN-hosted image URLs repeat
 * across thousands of pages, so the hit rate dominates after the first
 * few pages.
 *
 * The cache-miss upsert is a single statement:
 *
 * ```sql
 * INSERT INTO url_refs (...) VALUES (...)
 * ON CONFLICT(url) DO UPDATE SET url = url
 * RETURNING id
 * ```
 *
 * `DO UPDATE SET url = url` is a deliberate no-op update whose only
 * purpose is to make `RETURNING id` yield the existing row's id on
 * conflict. `INSERT OR IGNORE ... RETURNING id` must NOT be used here:
 * `RETURNING` returns zero rows when the insert is ignored, which would
 * leave the caller with no id and a `null` FK on the next entity INSERT.
 * @param qb - Knex instance or transaction connected to the archive DB.
 *   Callers inside a transaction MUST pass the `trx` so the read sees
 *   uncommitted rows from the same transaction.
 * @param caches - The connection's write-side id caches; mutated in place.
 * @param url - The URL string to resolve. Stored verbatim as the natural key.
 * @returns The `url_refs.id` of the existing or newly inserted row.
 * @example
 * const id = await upsertUrlRef(knex, caches, 'https://example.com/a');
 * const again = await upsertUrlRef(knex, caches, 'https://example.com/a');
 * // id === again, second call hits the cache and issues no SQL
 */
export async function upsertUrlRef(
	qb: Knex | Knex.Transaction,
	caches: WriteRefCaches,
	url: string,
): Promise<number> {
	const cached = caches.urlIds.get(url);
	if (cached !== undefined) {
		return cached;
	}
	const decomposed = decomposeUrl(url);
	const rows: { id: number }[] = await qb.raw(
		`INSERT INTO url_refs (url, scheme, host, port, path, query_hash, fragment)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(url) DO UPDATE SET url = url
		 RETURNING id`,
		[
			url,
			decomposed.scheme,
			decomposed.host,
			decomposed.port,
			decomposed.path,
			decomposed.query_hash,
			decomposed.fragment,
		],
	);
	const first = rows[0];
	if (first === undefined) {
		throw new Error(`upsertUrlRef: RETURNING yielded no row for ${url}`);
	}
	caches.urlIds.set(url, first.id);
	return first.id;
}
