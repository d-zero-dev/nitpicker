import type { HeaderTableCaches } from './types.js';
import type { Knex } from 'knex';

import { headerValueCacheKey } from './header-value-cache-key.js';

/**
 * Creates a {@link HeaderTableCaches} bundle warmed from the DB's current
 * `header_name_refs` / `header_value_refs` / `header_sets` rows.
 *
 * Warming lets idempotent re-runs (and resumed / appended crawls against
 * an archive that already holds header rows) reuse existing ids instead
 * of re-issuing an upsert per entry. On a fresh archive all three tables
 * are empty and the warm-up is three cheap SELECTs.
 *
 * The bundle is only valid for the connection (or transaction lineage)
 * it was warmed against — ids observed here are stable because the
 * header dictionaries are append-only, but a cache warmed on connection
 * A does not see rows a concurrent writer B added. The crawler holds a
 * single writer connection per archive, so this cannot occur in
 * practice.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @returns Warmed cache bundle ready for
 *   {@link ./upsert-one-header-set.ts}.
 * @example
 * const caches = await createHeaderTableCaches(knex);
 * const setId = await upsertOneHeaderSet(knex, decomposed, caches);
 */
export async function createHeaderTableCaches(trx: Knex): Promise<HeaderTableCaches> {
	const nameIdCache = new Map<string, number>();
	const nameRows: { id: number; name: string }[] = await trx('header_name_refs').select();
	for (const row of nameRows) {
		nameIdCache.set(row.name, row.id);
	}

	const valueIdCache = new Map<string, number>();
	const valueRows: { id: number; hash: Uint8Array; value: string }[] =
		await trx('header_value_refs').select();
	for (const row of valueRows) {
		valueIdCache.set(headerValueCacheKey(Buffer.from(row.hash), row.value), row.id);
	}

	const setIdByRawJsonHash = new Map<string, number>();
	const setIdByRawHash = new Map<string, number>();
	const setRows: { id: number; raw_json_hash: Uint8Array; raw_hash: Uint8Array }[] =
		await trx('header_sets').select('id', 'raw_json_hash', 'raw_hash');
	for (const row of setRows) {
		setIdByRawJsonHash.set(Buffer.from(row.raw_json_hash).toString('hex'), row.id);
		setIdByRawHash.set(Buffer.from(row.raw_hash).toString('hex'), row.id);
	}

	return {
		nameIdCache,
		valueIdCache,
		setIdByRawJsonHash,
		setIdByRawHash,
		setIdsProcessedThisRun: new Set<number>(),
	};
}
