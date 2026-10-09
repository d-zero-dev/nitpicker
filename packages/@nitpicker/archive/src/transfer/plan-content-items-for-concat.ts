import type { Knex } from 'knex';

import { contentItemRankSql } from './content-item-rank-sql.js';
import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

/**
 * Populates `temp.xfer_ci_plan` for one concat source: every source
 * `content_items` row is matched against the destination by URL string
 * (`url_refs.url`, not `url_id` — the two archives assign unrelated ids to
 * the same URL) and classified as:
 *
 * - `full` — no destination row exists yet for this URL.
 * - `replace` — a destination row exists, and this source's rank
 *   ({@link contentItemRankSql}) is greater than or equal to the
 *   destination's. `>=` (not `>`) is deliberate: sources are merged one at
 *   a time in argument order, always compared against the CURRENT
 *   destination state, so an equal rank still overwrites — this is what
 *   makes "ties go to the later argument" fall out naturally, with no
 *   extra tie-breaking logic needed.
 * - `skip` — a destination row exists and outranks this source's row; the
 *   destination's existing (better) observation is left untouched.
 *
 * Every source row gets a plan entry (concat never drops a row outright —
 * that only happens in split, where a row can be out of the new scope AND
 * unreferenced). `dest_id` is left `NULL` for `full` rows here; it is
 * filled in once {@link import('./insert-content-items.js').insertContentItems}
 * assigns the new destination id.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after
 *   {@link import('./create-transfer-temp-tables.js').createTransferTempTables}.
 * @example
 * ```ts
 * await planContentItemsForConcat(trx);
 * const { full, replace, skip } = await countPlanActions(trx); // for progress reporting
 * ```
 */
export async function planContentItemsForConcat(trx: Knex): Promise<void> {
	await trx.raw(`
		INSERT INTO xfer_ci_plan (src_id, action, dest_id)
		SELECT
			s.id,
			CASE
				WHEN d.id IS NULL THEN ${TRANSFER_ACTION.full}
				WHEN ${contentItemRankSql('s')} >= ${contentItemRankSql('d')} THEN ${TRANSFER_ACTION.replace}
				ELSE ${TRANSFER_ACTION.skip}
			END,
			d.id
		FROM ${TRANSFER_SOURCE_ALIAS}.content_items s
		JOIN ${TRANSFER_SOURCE_ALIAS}.url_refs su ON su.id = s.url_id
		LEFT JOIN main.url_refs du ON du.url = su.url
		LEFT JOIN main.content_items d ON d.url_id = du.id
	`);
}
