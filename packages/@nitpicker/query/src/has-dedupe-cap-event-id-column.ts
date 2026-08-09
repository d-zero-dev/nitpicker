import type { Knex } from 'knex';

/**
 * Whether the current archive connection has the
 * `content_items.dedupe_cap_event_id` column.
 *
 * Unlike `requireAliasOfIdColumn` (which throws when its column is
 * missing), a missing `dedupe_cap_event_id` is never an error here:
 * `--dedupe-cap` is opt-in, and every archive predating this feature simply
 * has zero pages marked — semantically identical to a present column where
 * every row is `NULL`. Callers therefore degrade the filter/select to a
 * deterministic "nothing is marked" answer instead of throwing. Mirrors
 * `hasPageTemplatesTable`'s table-existence check and pairs with
 * `dedupeCapShapeKeySelectColumn` (`dedupe-cap-shape-key-select-column.ts`)
 * the same way that function pairs with `templateKeySelectColumn` — always
 * consulted together (check once per query, thread the boolean through the
 * join/select/filter sites), but kept in separate files per this archive's
 * one-export-per-file convention.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns Whether `content_items.dedupe_cap_event_id` exists on this connection.
 * @example
 * const hasDedupeCapColumn = await hasDedupeCapEventIdColumn(knex);
 * if (hasDedupeCapColumn) {
 *   query.leftJoin('dedupe_cap_events as dce', 'dce.id', 'ci.dedupe_cap_event_id');
 * }
 */
export async function hasDedupeCapEventIdColumn(knex: Knex): Promise<boolean> {
	return knex.schema.hasColumn('content_items', 'dedupe_cap_event_id');
}
