import type { WriteRefCaches } from '../../_shared/types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';
import { resolveUrlRefs } from '../../../populate-entity-tables/resolve-url-refs.js';
import { decomposeUrl } from '../../../populate-ref-tables/decompose-url.js';

/**
 * Parameters for {@link insertInventoryContentItems}.
 */
export interface InsertInventoryContentItemsParams {
	/** Knex query builder connected to the archive DB. */
	readonly knex: Knex;
	/** The connection's write-side id caches. */
	readonly caches: WriteRefCaches;
	/** URL strings already in `withoutHashAndAuth` form. */
	readonly urls: readonly string[];
	/** `content_items` column values shared by every inserted row (everything except `url_id`). */
	readonly row: Readonly<Record<string, number | string>>;
	/** Calling op's name, used to prefix the unresolved-url_ref error message. */
	readonly opName: string;
}

/**
 * Shared body of the inventory `content_items` bulk-insert ops
 * (`insertInventorySeeds` / `insertInventorySkippedPages`): chunked
 * `url_refs` upsert → id resolution → `content_items` insert-ignore →
 * write-cache population. The two callers differ only in the row
 * constants they stamp on every row, so the invariant-heavy plumbing
 * lives here exactly once:
 *
 * - Chunked into 500-URL batches so SQLite's bound-parameter limit
 *   (`SQLITE_MAX_VARIABLE_NUMBER`) cannot be hit even on a
 *   tens-of-thousands inventory list.
 * - Both inserts are `ON CONFLICT ... IGNORE`, so existing rows — in
 *   particular previously crawled pages — are never overwritten
 *   (crawled-wins), and within-list duplicates collapse to one row.
 * - The `urlIds` / `contentItems` write caches are populated from what
 *   the DB actually holds after the insert (not from the attempted row
 *   values), keeping later cache-hits consistent with conflict-ignored
 *   rows.
 * @param params - See {@link InsertInventoryContentItemsParams}.
 */
export async function insertInventoryContentItems(
	params: InsertInventoryContentItemsParams,
): Promise<void> {
	const { knex, caches, urls, row, opName } = params;
	if (urls.length === 0) {
		return;
	}
	await eachSplitted([...urls], 500, async (chunk) => {
		await knex('url_refs')
			.insert(chunk.map((url) => ({ url, ...decomposeUrl(url) })))
			.onConflict('url')
			.ignore();
		const urlIds = await resolveUrlRefs(knex, chunk);
		const rows = chunk.map((url) => {
			const urlId = urlIds.get(url);
			if (urlId === undefined) {
				throw new Error(`${opName}: url_refs.id not resolved for ${url}`);
			}
			caches.urlIds.set(url, urlId);
			return {
				url_id: urlId,
				...row,
			};
		});
		await knex('content_items').insert(rows).onConflict('url_id').ignore();
		const inserted = (await knex
			.select('ci.id', 'ci.source', 'ur.url')
			.from('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.whereIn('ur.url', chunk)) as {
			id: number;
			source: 'inventory-seed';
			url: string;
		}[];
		for (const insertedRow of inserted) {
			caches.contentItems.set(insertedRow.url, {
				id: insertedRow.id,
				source: insertedRow.source,
			});
		}
	});
}
