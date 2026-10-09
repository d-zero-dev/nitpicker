import type { Knex } from 'knex';

import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const SRC = TRANSFER_SOURCE_ALIAS;

/**
 * Copies `resource_ref_edges` (page → resource references) for every
 * `full`/`replace`-action page whose referenced resource is also kept
 * (`temp.xfer_ri_plan`, INNER JOIN — a resource split's
 * `plan-resource-items.ts` dropped has no destination row, so any edge
 * pointing at it is correctly skipped rather than inserted with a
 * dangling `resource_id`).
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after both
 *   `temp.xfer_ci_plan` (with `dest_id` resolved) and `temp.xfer_ri_plan`
 *   (with `dest_id` resolved by
 *   {@link import('./copy-resource-items.js').copyResourceItems}).
 * @example
 * ```ts
 * await copyResourceItems(trx, 'concat');
 * await copyResourceRefEdges(trx);
 * ```
 */
export async function copyResourceRefEdges(trx: Knex): Promise<void> {
	await trx.raw(`
		INSERT INTO main.resource_ref_edges (resource_id, page_id, count)
		SELECT rp.dest_id, p.dest_id, e.count
		FROM ${SRC}.resource_ref_edges e
		JOIN xfer_ci_plan p ON p.src_id = e.page_id
			AND p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.replace})
		JOIN xfer_ri_plan rp ON rp.src_id = e.resource_id
		WHERE true
		ON CONFLICT(resource_id, page_id) DO NOTHING
	`);
}
