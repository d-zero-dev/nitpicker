import type { Knex } from 'knex';

import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

/**
 * Remaps `redirect_dest_id` for every `full`/`stub`/`replace`-action
 * destination row this source just wrote, from the source's own id space
 * into the destination's, via `temp.xfer_ci_plan` (which by this point
 * maps EVERY source id to a destination id, not just the ones this source
 * inserted — `skip`/`replace` rows already had `dest_id` set at plan
 * time).
 *
 * `skip`-action rows are deliberately excluded from the `SET` target
 * (via the `p.action IN (...)` filter) — a `skip` row's `content_items`
 * row belongs to a PRIOR, better-ranked source, and this (losing) source
 * has no business touching its `redirect_dest_id`.
 *
 * Must run AFTER both
 * {@link import('./insert-content-items.js').insertContentItems} and
 * {@link import('./replace-content-items.js').replaceContentItems} —
 * every plan row needs a resolved `dest_id` (its own AND its redirect
 * target's) before this can run. A source row whose `redirect_dest_id`
 * points outside this source's own plan (should not happen — concat's
 * plan covers every source row, and split's plan closure always pulls a
 * kept row's redirect target in too, see `plan-content-items-for-split.ts`)
 * silently leaves that destination row's `redirect_dest_id` at `NULL`
 * rather than erroring — a dangling-but-absent redirect is a safe
 * degrade, never a wrong one.
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}.
 * @example
 * ```ts
 * await insertContentItems(trx, { crawlOrderOffset: 0 });
 * await remapRedirectDestIds(trx);
 * ```
 */
export async function remapRedirectDestIds(trx: Knex): Promise<void> {
	await trx.raw(`
		UPDATE main.content_items
		SET redirect_dest_id = x.redirect_dest_id
		FROM (
			SELECT p.dest_id AS id, p2.dest_id AS redirect_dest_id
			FROM xfer_ci_plan p
			JOIN ${TRANSFER_SOURCE_ALIAS}.content_items s ON s.id = p.src_id
			JOIN xfer_ci_plan p2 ON p2.src_id = s.redirect_dest_id
			WHERE s.redirect_dest_id IS NOT NULL
				AND p.action IN (${TRANSFER_ACTION.full}, ${TRANSFER_ACTION.stub}, ${TRANSFER_ACTION.replace})
				AND p2.dest_id IS NOT NULL
		) x
		WHERE main.content_items.id = x.id
			AND x.redirect_dest_id != x.id
	`);
}
