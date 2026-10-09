import type { Knex } from 'knex';

/**
 * Lists a table's column names via SQLite's `pragma_table_info` table-valued
 * function, in declaration order, minus any names in `exclude`.
 *
 * A transfer copy must NEVER build its column list from a hand-written
 * literal or from `SELECT *` — migrated archives add columns via `ALTER
 * TABLE ADD COLUMN`, which always appends at the end, so a fresh archive's
 * `content_items` (say) can have `alias_of_id` earlier in declaration order
 * than a migrated archive's copy of the same table. A positional `INSERT
 * ... SELECT * FROM other_table` across two archives with different column
 * orders would silently shift values into the wrong columns. Reading each
 * side's own column list and building an explicit, named `SELECT
 * <col1>, <col2>, ...` (this function's contract) sidesteps the problem
 * entirely — column order never matters when every column is named.
 *
 * The pragma table-valued function must be schema-qualified as
 * `<schema>.pragma_table_info(<table>)` — `pragma_table_info('schema.table')`
 * silently returns zero rows instead of erroring, so `schema` and `table`
 * are deliberately separate parameters rather than one dotted string a
 * caller could get wrong.
 * @param knex - Knex query builder connected to the archive DB.
 * @param schema - The schema the table lives in: `'main'` for the
 *   destination, or the attached source's alias (`TRANSFER_SOURCE_ALIAS`).
 * @param table - Bare table name (no schema prefix).
 * @param exclude - Column names to omit (typically the PK, which a copy
 *   assigns fresh via `AUTOINCREMENT` rather than carrying over).
 * @returns Column names in declaration order, minus `exclude`.
 * @example
 * ```ts
 * const columns = await listTransferColumns(trx, 'xfer_src', 'content_items', ['id']);
 * // ['url_id', 'is_external', 'scraped', ...] — in THIS archive's own order
 * ```
 */
export async function listTransferColumns(
	knex: Knex,
	schema: string,
	table: string,
	exclude: readonly string[] = [],
): Promise<string[]> {
	const excludeSet = new Set(exclude);
	const rows: { name: string }[] = await knex
		.select('name')
		.from(knex.raw(`${schema}.pragma_table_info(?)`, [table]))
		.orderBy('cid');
	const columns = rows.map((row) => row.name).filter((name) => !excludeSet.has(name));
	if (columns.length === 0) {
		throw new Error(`No columns found for table "${schema}.${table}" — does it exist?`);
	}
	return columns;
}
