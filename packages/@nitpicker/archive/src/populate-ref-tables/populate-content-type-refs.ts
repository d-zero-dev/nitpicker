import type { Knex } from 'knex';

import { classifyContentType } from './classify-content-type.js';
import { normalizeMime } from './normalize-mime.js';

/**
 * Distinct-`contentType` rows are collected from `pages` + `resources` in
 * chunks of this size before being written into `content_type_refs`. The
 * DISTINCT list is expected to be tiny (< 1000 rows even on the largest
 * archives — the wire content-type space is small) so the chunk size only
 * bounds worst-case parameter counts on `INSERT ... VALUES ...`.
 */
const INSERT_CHUNK_SIZE = 500;

/**
 * Populates `content_type_refs` from every distinct `contentType` value
 * currently stored in `pages` and `resources` (issue #191).
 *
 * Two independent DISTINCT SELECTs (one per table) are merged in JS
 * rather than via SQL `UNION` — the cardinality is small in practice and
 * doing it in JS avoids the knex-`union().select()` column-aliasing
 * quirk (bare `.select()` on a union wraps in `SELECT *` and can lose
 * the column name depending on driver version). Two per-table SELECTs
 * are also fast because `contentType` is indexed on both tables via
 * `idx_pages_listfilter` / natural column index (see `init-schema.ts`).
 *
 * `normalized` and `category` are derived in JS via {@link classifyContentType}
 * so the rule table stays in one place; SQLite has no equivalent
 * expression.
 *
 * `INSERT OR IGNORE` on the natural key `raw` makes this idempotent —
 * re-running this populate after a partial failure never duplicates
 * rows, only appends the new ones.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateContentTypeRefs(trx);
 * });
 */
export async function populateContentTypeRefs(trx: Knex): Promise<void> {
	const distinctRaw = new Set<string>();
	if (await trx.schema.hasTable('pages')) {
		const pagesRows: { contentType: string | null }[] = await trx('pages')
			.distinct('contentType')
			.whereNotNull('contentType');
		for (const { contentType } of pagesRows) {
			if (contentType != null && contentType !== '') {
				distinctRaw.add(contentType);
			}
		}
	}
	if (await trx.schema.hasTable('resources')) {
		const resourcesRows: { contentType: string | null }[] = await trx('resources')
			.distinct('contentType')
			.whereNotNull('contentType');
		for (const { contentType } of resourcesRows) {
			if (contentType != null && contentType !== '') {
				distinctRaw.add(contentType);
			}
		}
	}
	if (distinctRaw.size === 0) {
		return;
	}

	const inserts = [...distinctRaw].map((raw) => ({
		raw,
		normalized: normalizeMime(raw),
		category: classifyContentType(raw),
	}));

	for (let index = 0; index < inserts.length; index += INSERT_CHUNK_SIZE) {
		const chunk = inserts.slice(index, index + INSERT_CHUNK_SIZE);
		await trx('content_type_refs').insert(chunk).onConflict('raw').ignore();
	}
}
