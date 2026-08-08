import type { Knex } from 'knex';

/**
 * Builds the `isDedupeCapped` select expression, degrading to a `0` literal
 * when `hasDedupeCapEventIdColumn` (`has-dedupe-cap-event-id-column.ts`)
 * is false so callers can always include it in a column list without
 * conditionally reshaping that list.
 *
 * Unlike `dedupeCapShapeKeySelectColumn` (`dedupe-cap-shape-key-select-column.ts`,
 * which surfaces the shape key text for `PageDetail`), this projects a plain
 * 0/1 flag for `PageListItem`
 * — list rows only need "is this page marked", never the shape key itself.
 * @param knex - Knex query builder connected to the archive DB.
 * @param hasDedupeCapColumn - Result of `hasDedupeCapEventIdColumn` for this connection.
 * @returns A knex-select-compatible column expression aliased to `isDedupeCapped`.
 * @example
 * query.select(...PAGE_LIST_SELECT_COLUMNS, isDedupeCappedSelectColumn(knex, hasDedupeCapColumn));
 */
export function isDedupeCappedSelectColumn(knex: Knex, hasDedupeCapColumn: boolean) {
	return hasDedupeCapColumn
		? knex.raw('(ci.dedupe_cap_event_id is not null) as isDedupeCapped')
		: knex.raw('0 as isDedupeCapped');
}
