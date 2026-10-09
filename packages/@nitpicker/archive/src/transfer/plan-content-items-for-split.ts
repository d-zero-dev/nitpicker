import type { Knex } from 'knex';

import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

/**
 * Populates `temp.xfer_ci_plan` for split, in three passes over the
 * source's `content_items`:
 *
 * 1. **Core** — every id `temp.xfer_ci_in_scope` marked (in-scope,
 *    internal — see
 *    {@link import('./mark-in-scope-content-items.js').markInScopeContentItems})
 *    is kept in `full`.
 * 2. **Redirect-destination promotion** — a core row's `redirect_dest_id`,
 *    when it points at an INTERNAL row, joins core as `full` too, even if
 *    that destination's own path falls outside the split scope. This is
 *    the same invariant `insertPage` documents: "the redirect destination
 *    of an in-scope request is recorded internal even when its path is out
 *    of scope" (a soft-404 landing page is the canonical example) — split
 *    must not treat that page differently than a live crawl would. Only
 *    ONE hop is honoured here, matching `redirect_dest_id`'s own
 *    contract: crawler writes always pre-flatten a redirect chain to its
 *    final destination at write time, so a single JOIN already reaches the
 *    terminal page — there is no multi-hop chain left to walk in a
 *    single, not-yet-merged source archive (concat, which CAN reintroduce
 *    a multi-hop chain by combining two sources, re-flattens separately —
 *    see `flatten-redirect-chains.ts`).
 * 3. **Referenced-row stubbing** — any row NOT in core that a core row's
 *    `anchor_edges` targets, or that a core row's `redirect_dest_id`
 *    points at (now only the EXTERNAL case survives this filter, since
 *    every internal destination was already absorbed into core by pass
 *    2), is kept as a `stub`: the `content_items` row only, forced
 *    external — see `insert-content-items.ts`. A row reachable by neither
 *    path is left out of the plan entirely, which is split's definition
 *    of "dropped".
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after
 *   {@link import('./mark-in-scope-content-items.js').markInScopeContentItems}
 *   has populated `temp.xfer_ci_in_scope`.
 * @example
 * ```ts
 * await markInScopeContentItems(trx, scope, sourceConfig);
 * await planContentItemsForSplit(trx);
 * ```
 */
export async function planContentItemsForSplit(trx: Knex): Promise<void> {
	await trx.raw(`
		INSERT INTO xfer_ci_plan (src_id, action)
		SELECT src_id, ${TRANSFER_ACTION.full} FROM xfer_ci_in_scope
	`);

	await trx.raw(`
		INSERT INTO xfer_ci_plan (src_id, action)
		SELECT DISTINCT d.id, ${TRANSFER_ACTION.full}
		FROM ${TRANSFER_SOURCE_ALIAS}.content_items s
		JOIN xfer_ci_plan p ON p.src_id = s.id
		JOIN ${TRANSFER_SOURCE_ALIAS}.content_items d ON d.id = s.redirect_dest_id
		WHERE d.is_external = 0
			AND d.id NOT IN (SELECT src_id FROM xfer_ci_plan)
	`);

	await trx.raw(`
		INSERT OR IGNORE INTO xfer_ci_ref (src_id)
		SELECT DISTINCT ae.href_page_id
		FROM ${TRANSFER_SOURCE_ALIAS}.anchor_edges ae
		JOIN xfer_ci_plan p ON p.src_id = ae.page_id
		WHERE ae.href_page_id NOT IN (SELECT src_id FROM xfer_ci_plan)
	`);
	// `OR IGNORE` on BOTH inserts (not just this one) is deliberate, not
	// redundant: this table's PK is `src_id`, and an anchor target can also
	// be a redirect target of some other core row, so the two passes can
	// legitimately overlap. The first pass alone cannot collide with itself
	// (`SELECT DISTINCT` on an empty destination table), but relying on
	// that ordering to justify leaving it unguarded would silently break if
	// a third insert into `xfer_ci_ref` were ever added ahead of it.
	await trx.raw(`
		INSERT OR IGNORE INTO xfer_ci_ref (src_id)
		SELECT DISTINCT s.redirect_dest_id
		FROM ${TRANSFER_SOURCE_ALIAS}.content_items s
		JOIN xfer_ci_plan p ON p.src_id = s.id
		WHERE s.redirect_dest_id IS NOT NULL
			AND s.redirect_dest_id NOT IN (SELECT src_id FROM xfer_ci_plan)
	`);

	await trx.raw(`
		INSERT INTO xfer_ci_plan (src_id, action)
		SELECT src_id, ${TRANSFER_ACTION.stub} FROM xfer_ci_ref
	`);
}
