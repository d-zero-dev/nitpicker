import type { Knex } from 'knex';

import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

/**
 * Populates `temp.xfer_ri_plan` for `resource_items`, one call per source,
 * for either transfer mode:
 *
 * - **`concat`** — every source resource is matched against the
 *   destination by its identity (`url_id` resolved through `url_refs.url`,
 *   or `url_blob_id` resolved through `blob_refs.hash` — the two are
 *   mutually exclusive per `resource_items`' own CHECK constraint, so at
 *   most one of the two LEFT JOINs below ever produces a match for a given
 *   row) and classified `full` (no destination row yet), `replace`
 *   (destination exists but has never recorded a response — `status IS
 *   NULL` — while this source has), or `skip` (destination already has a
 *   recorded response). Matching happens directly against raw
 *   `url`/`hash` values, not through `temp.xfer_map_url_refs`/
 *   `xfer_map_blob_refs` — those dictionary maps are built AFTER this
 *   plan (`copy-dictionaries-for-concat.ts` needs to know which resources
 *   are kept before it can compute needed dictionary ids for split), so
 *   this plan cannot depend on them.
 * - **`split`** — a resource is kept (`full`) only when at least one
 *   `full`-action page in `temp.xfer_ci_plan` references it via
 *   `resource_ref_edges`. A resource with no surviving referrer is left
 *   out of the plan (dropped) — split does not preserve an
 *   otherwise-orphan resource just because its URL happens to still be
 *   in scope (accepted simplification: a resource with zero referring
 *   pages has no page context left to display it against in the output
 *   archive anyway).
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. For `'split'`, must run after
 *   `temp.xfer_ci_plan` has been fully populated (every `full` page
 *   decided) — see
 *   {@link import('./plan-content-items-for-split.js').planContentItemsForSplit}.
 * @param mode - Which transfer this plan is for.
 * @example
 * ```ts
 * await planContentItemsForSplit(trx);
 * await planResourceItems(trx, 'split');
 * ```
 */
export async function planResourceItems(
	trx: Knex,
	mode: 'concat' | 'split',
): Promise<void> {
	if (mode === 'split') {
		await trx.raw(`
			INSERT INTO xfer_ri_plan (src_id, action)
			SELECT DISTINCT r.id, ${TRANSFER_ACTION.full}
			FROM ${TRANSFER_SOURCE_ALIAS}.resource_items r
			JOIN ${TRANSFER_SOURCE_ALIAS}.resource_ref_edges e ON e.resource_id = r.id
			JOIN xfer_ci_plan p ON p.src_id = e.page_id AND p.action = ${TRANSFER_ACTION.full}
		`);
		return;
	}

	await trx.raw(`
		INSERT INTO xfer_ri_plan (src_id, action, dest_id)
		SELECT
			s.id,
			CASE
				WHEN d.id IS NULL THEN ${TRANSFER_ACTION.full}
				WHEN (s.status IS NOT NULL) >= (d.status IS NOT NULL) THEN ${TRANSFER_ACTION.replace}
				ELSE ${TRANSFER_ACTION.skip}
			END,
			d.id
		FROM ${TRANSFER_SOURCE_ALIAS}.resource_items s
		LEFT JOIN ${TRANSFER_SOURCE_ALIAS}.url_refs su ON su.id = s.url_id
		LEFT JOIN main.url_refs du ON du.url = su.url
		LEFT JOIN ${TRANSFER_SOURCE_ALIAS}.blob_refs sb ON sb.id = s.url_blob_id
		LEFT JOIN main.blob_refs db ON db.hash = sb.hash
		LEFT JOIN main.resource_items d ON d.url_id = du.id OR d.url_blob_id = db.id
	`);
}
