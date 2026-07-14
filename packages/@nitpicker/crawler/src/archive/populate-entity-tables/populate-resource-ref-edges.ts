import type { Knex } from 'knex';

/**
 * Populates `resource_ref_edges` from `resources-referrers`
 * (issue #193 step 6-D-5).
 *
 * The transformation is a **direct SQL `INSERT ... SELECT`** — no ref
 * lookups, no per-row JS work. Legacy `resources-referrers` already
 * enforces `UNIQUE(resourceId, pageId)` (see `init-schema.ts`), so every
 * source row maps 1:1 to a distinct `resource_ref_edges` PK; every
 * `count` starts at `1` because the legacy shape observed each
 * (resource, page) pair exactly once.
 *
 * `INSERT OR IGNORE` on the `(resource_id, page_id)` PK is redundant
 * with the legacy unique constraint on the source but present anyway to
 * make partial-failure re-runs safe.
 *
 * The PKs on both `resource_items.id` and `content_items.id` were
 * preserved from `resources.id` / `pages.id`, so no per-row translation
 * is required — the FKs `resource_items(id)` and `content_items(id)`
 * declared in `resource_ref_edges` are already satisfied for every
 * source row by the earlier 0.13 steps.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateResourceItems(trx);
 *   await populateContentItems(trx);
 *   await populateResourceRefEdges(trx);
 * });
 */
export async function populateResourceRefEdges(trx: Knex): Promise<void> {
	await trx.raw(
		`INSERT OR IGNORE INTO resource_ref_edges (resource_id, page_id, count)
		 SELECT resourceId, pageId, 1 FROM "resources-referrers"`,
	);
}
