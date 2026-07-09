import type { ExternalLinkInsertRow } from './types.js';
import type { Knex } from 'knex';

/** Rows written per `INSERT` statement while upserting `viewer_external_links`. */
const INSERT_CHUNK_SIZE = 500;

/**
 * Inserts one chunk of {@link ExternalLinkInsertRow}s into
 * `viewer_external_links`, adding `referrer_count` into any row already
 * there (from an earlier chunk in the same build) instead of overwriting
 * it.
 *
 * This is the merge point that lets `deriveExternalLinkSummaryRows` stay a
 * pure, stateless per-chunk function: since `computeAnchorFactRows` yields
 * `anchors` in `source.id`-range chunks, and any two chunks can both
 * contain referrers of the same external `dest_page_id`, the running total
 * has to accumulate somewhere. Doing it here via `ON CONFLICT (dest_page_id)
 * DO UPDATE SET referrer_count = referrer_count + excluded.referrer_count`
 * keeps that accumulation in SQLite instead of a JS `Map` that an earlier
 * version of this build kept alive across the whole scan — which grew
 * unboundedly with the number of distinct external destinations (e.g.
 * ad/tracking links whose query strings make every render's target URL
 * unique) and defeated `computeAnchorFactRows`'s own OOM fix. `dest_url_ref_id`/
 * `status` are never updated on conflict: both are properties of the
 * destination page itself, so they're identical across every chunk that
 * observes the same `dest_page_id`.
 * @param trx - An open Knex transaction.
 * @param rows - One chunk's `viewer_external_links` rows to merge in —
 *   typically {@link deriveExternalLinkSummaryRows}'s output for one
 *   `computeAnchorFactRows` chunk.
 * @example
 * for await (const anchorFactChunk of computeAnchorFactRows(trx)) {
 *   await upsertExternalLinkRows(trx, deriveExternalLinkSummaryRows(anchorFactChunk));
 * }
 */
export async function upsertExternalLinkRows(
	trx: Knex,
	rows: readonly ExternalLinkInsertRow[],
): Promise<void> {
	for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
		await trx('viewer_external_links')
			.insert(rows.slice(start, start + INSERT_CHUNK_SIZE))
			.onConflict('dest_page_id')
			.merge({
				referrer_count: trx.raw(
					'"viewer_external_links"."referrer_count" + "excluded"."referrer_count"',
				),
			});
	}
}
