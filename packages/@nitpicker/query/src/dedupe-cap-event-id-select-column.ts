import type { Knex } from 'knex';

/**
 * Builds the `dedupeCapEventId` select expression, degrading to a `NULL`
 * literal when `hasDedupeCapEventIdColumn` (`has-dedupe-cap-event-id-column.ts`)
 * is false so callers can always include it in a column list without
 * conditionally reshaping that list.
 *
 * Pairs with `dedupeCapShapeKeySelectColumn` the same way that function
 * pairs with `hasDedupeCapEventIdColumn` — both read the same `dce`-aliased
 * `LEFT JOIN dedupe_cap_events`, but this one exposes the event's `id` so
 * the viewer can link back to that event's entry in the Crawl Suppression
 * view (`/crawl-suppression#event-<id>`), which `shape_key` alone cannot do.
 * @param knex - Knex query builder connected to the archive DB.
 * @param hasDedupeCapColumn - Result of `hasDedupeCapEventIdColumn` for this connection.
 * @returns A knex-select-compatible column expression aliased to `dedupeCapEventId`.
 * @example
 * query.select(...PAGE_DETAIL_COLUMNS, dedupeCapEventIdSelectColumn(knex, hasDedupeCapColumn));
 */
export function dedupeCapEventIdSelectColumn(knex: Knex, hasDedupeCapColumn: boolean) {
	return hasDedupeCapColumn
		? 'dce.id as dedupeCapEventId'
		: knex.raw('NULL as dedupeCapEventId');
}
