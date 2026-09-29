import type { Knex } from 'knex';

import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

/**
 * Copies `page_html_blobs` rows referenced by kept pages' `page_html_ref`.
 *
 * `page_html_blobs.hash` is itself the content-addressed identity (the
 * table's PK, computed the same way in every archive) — unlike every
 * other dictionary in `archive/transfer/`, there is no separate integer id
 * to remap: {@link import('./copy-page-meta.js').copyPageMeta}'s
 * `page_html_ref` copy carries the source's `hash` value straight through
 * unchanged, and it already resolves in the destination once this
 * function has run. No `temp.xfer_map_*` table exists for this dictionary.
 *
 * The filter (`action IN (full, replace)`) applies identically to both
 * transfer modes: split's plan never assigns `replace`, so for split this
 * is exactly "full pages only"; concat's plan never assigns `stub`, so for
 * concat this is exactly "every page whose `page_html_ref` copy will
 * actually run" (`stub` rows, split-only, never get a `page_html_ref`
 * copied either way).
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after `temp.xfer_ci_plan` is
 *   fully populated, before `copy-page-meta.ts`'s `page_html_ref` copy
 *   (which assumes the blob it points at already exists — `page_html_ref`
 *   has an FK on `hash`).
 * @example
 * ```ts
 * await planContentItemsForSplit(trx);
 * await copyPageHtmlBlobs(trx);
 * await copyPageMeta(trx); // copies page_html_ref among other tables
 * ```
 */
export async function copyPageHtmlBlobs(trx: Knex): Promise<void> {
	await trx.raw(`
		INSERT INTO main.page_html_blobs (hash, body, codec, size_raw, size_stored)
		SELECT DISTINCT b.hash, b.body, b.codec, b.size_raw, b.size_stored
		FROM ${TRANSFER_SOURCE_ALIAS}.page_html_blobs b
		JOIN ${TRANSFER_SOURCE_ALIAS}.page_html_ref ref ON ref.hash = b.hash
		JOIN xfer_ci_plan p ON p.src_id = ref.page_id
			AND p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.replace})
		WHERE true
		ON CONFLICT(hash) DO NOTHING
	`);
}
