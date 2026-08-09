import type { Knex } from 'knex';

/**
 * Builds the `dedupeCapShapeKey` select expression, degrading to a `NULL`
 * literal when `hasDedupeCapEventIdColumn` (`has-dedupe-cap-event-id-column.ts`)
 * is false so callers can always include it in a column list without
 * conditionally reshaping that list.
 *
 * Selects `dedupe_cap_events.shape_key` (aliased `dce` by the caller's
 * `LEFT JOIN`) rather than the raw `dedupe_cap_event_id` — `shape_key` is
 * `NOT NULL` on that table, so its presence/absence after the join already
 * distinguishes "capped" from "not capped" without a second column; callers
 * needing a boolean can just check this value for `null`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param hasDedupeCapColumn - Result of `hasDedupeCapEventIdColumn` for this connection.
 * @returns A knex-select-compatible column expression aliased to `dedupeCapShapeKey`.
 * @example
 * query.select(...PAGE_DETAIL_COLUMNS, dedupeCapShapeKeySelectColumn(knex, hasDedupeCapColumn));
 */
export function dedupeCapShapeKeySelectColumn(knex: Knex, hasDedupeCapColumn: boolean) {
	return hasDedupeCapColumn
		? 'dce.shape_key as dedupeCapShapeKey'
		: knex.raw('NULL as dedupeCapShapeKey');
}
