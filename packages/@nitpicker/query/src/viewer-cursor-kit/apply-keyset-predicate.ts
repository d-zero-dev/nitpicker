import type { Knex } from 'knex';

/**
 * Adds a keyset comparison tuple as a `WHERE` predicate — `(col1, col2, …)
 * {>|<} (?, ?, …)` — using SQLite's row-value comparison. Shared by every
 * `viewer_*` table's keyset-cursor orchestrator via `readKeysetWindow`.
 * @param qb - The query builder to constrain.
 * @param columns - The keyset tuple columns, in comparison order. Column
 *   names come from each table's own fixed `KeysetSortSpec` column set,
 *   never from request input, so interpolating them into the SQL text
 *   (rather than parameter binding, which only covers values) carries no
 *   injection risk.
 * @param operator - `'>'` for a forward (ascending-tuple) seek, `'<'` for a
 *   backward one.
 * @param values - The boundary row's tuple values, in `columns` order.
 */
export function applyKeysetPredicate(
	qb: Knex.QueryBuilder,
	columns: readonly string[],
	operator: '>' | '<',
	values: readonly (string | number)[],
): void {
	const columnList = columns.join(', ');
	const placeholders = columns.map(() => '?').join(', ');
	qb.whereRaw(`(${columnList}) ${operator} (${placeholders})`, [...values]);
}
