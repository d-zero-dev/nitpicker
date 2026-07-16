import type { Knex } from 'knex';

import { createHeaderTableCaches } from './create-header-table-caches.js';
import { decomposeHeaderSet } from './decompose-header-set.js';
import { upsertOneHeaderSet } from './upsert-one-header-set.js';

/**
 * Rows scanned per SELECT chunk against `pages.responseHeaders` /
 * `resources.responseHeaders`. Keyset-paginated on `id` to avoid loading
 * a 470k-row `responseHeaders` column into a single query result.
 */
const READ_CHUNK_SIZE = 500;

/**
 * Populates the five header decomposition tables (`header_name_refs`,
 * `header_value_refs`, `header_sets`, `header_set_entries`,
 * `header_flags`) from every `pages.responseHeaders` and
 * `resources.responseHeaders` JSON blob (issue #191).
 *
 * Strategy:
 *
 * 1. **Warm caches** via {@link ./create-header-table-caches.ts} — load
 *    existing `header_name_refs`, `header_value_refs`, and `header_sets`
 *    rows into id maps. Idempotent re-runs then reuse ids instead of
 *    re-issuing an upsert per entry, and new ids are appended as they
 *    are inserted.
 * 2. **Stream `pages.responseHeaders` + `resources.responseHeaders`** in
 *    id-keyset chunks. Each non-null value is decomposed via
 *    {@link decomposeHeaderSet} and written via
 *    {@link ./upsert-one-header-set.ts} — the same per-set primitive the
 *    crawler's live write path uses, so migrated and live-crawled
 *    archives produce identical header rows.
 *
 * Every write is bulk-batched so the migration stays O(chunks × per-
 * chunk-distinct-decomposed-sets) round-trips against the DB. Idempotency
 * across full re-runs is guaranteed by the `INSERT OR IGNORE`s and the
 * `setIdsProcessedThisRun` guard inside the per-set upsert.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateHeaderTables(trx);
 * });
 */
export async function populateHeaderTables(trx: Knex): Promise<void> {
	const caches = await createHeaderTableCaches(trx);

	for (const table of ['pages', 'resources'] as const) {
		const hasTable = await trx.schema.hasTable(table);
		if (!hasTable) {
			continue;
		}
		const hasColumn = await trx.schema.hasColumn(table, 'responseHeaders');
		if (!hasColumn) {
			continue;
		}
		let cursor = 0;
		while (true) {
			const rows: { id: number; responseHeaders: string | null }[] = await trx(table)
				.select('id', 'responseHeaders')
				.where('id', '>', cursor)
				.orderBy('id', 'asc')
				.limit(READ_CHUNK_SIZE);
			if (rows.length === 0) {
				break;
			}
			cursor = rows.at(-1)!.id;
			for (const row of rows) {
				const decomposed = decomposeHeaderSet(row.responseHeaders);
				if (decomposed === null) {
					continue;
				}
				await upsertOneHeaderSet(trx, decomposed, caches);
			}
		}
	}
}
