import type { Knex } from 'knex';

import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;

/**
 * Copies `anchor_edges` for every `full`/`replace`-action page's OUTBOUND
 * links, remapping both `page_id` (the link's own page — must be
 * `full`/`replace`, same rule as every other page-scoped table) and
 * `href_page_id` (the link's target — resolved through
 * `temp.xfer_ci_plan` directly, via an INNER JOIN, NOT `LEFT JOIN`):
 *
 * - Concat: every source row has a plan entry (even `skip`), so the
 *   INNER JOIN always matches — an anchor to a `skip`ped URL still
 *   resolves to whichever destination row won that URL.
 * - Split: a target NOT in the plan means "dropped" (out of scope and
 *   unreferenced by anything else) — the INNER JOIN drops that anchor
 *   row entirely rather than inserting a dangling `href_page_id`. This is
 *   intentional: `plan-content-items-for-split.ts`'s own closure already
 *   guarantees every anchor target of a KEPT page is itself kept (as
 *   `full` or `stub`), so in practice this INNER JOIN never actually
 *   filters anything out for split — it exists as a structural safety net,
 *   not as an active filter.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}.
 * @example
 * ```ts
 * await copyPageMeta(trx);
 * await copyAnchorEdges(trx);
 * ```
 */
export async function copyAnchorEdges(trx: Knex): Promise<void> {
	await trx.raw(`
		INSERT INTO main.anchor_edges (page_id, href_page_id, count, first_hash, first_text_id)
		SELECT p.dest_id, pd.dest_id, ae.count, ae.first_hash, mt.dest_id
		FROM ${SRC}.anchor_edges ae
		JOIN xfer_ci_plan p ON p.src_id = ae.page_id
			AND p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.replace})
		JOIN xfer_ci_plan pd ON pd.src_id = ae.href_page_id
		LEFT JOIN xfer_map_text_refs mt ON mt.src_id = ae.first_text_id
		WHERE true
		ON CONFLICT(page_id, href_page_id) DO NOTHING
	`);
}
