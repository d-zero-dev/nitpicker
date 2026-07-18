import type { Knex } from 'knex';

/**
 * Returns the set of parent table names referenced by `table`'s FK
 * clauses, read via SQLite's `pragma_foreign_key_list` table-valued
 * function. Shared by the specs that assert FK declarations were
 * retargeted from the legacy `pages(id)` to `content_items(id)`.
 * @param db - Knex connected to the test DB.
 * @param table - Table whose FK declarations to inspect.
 * @returns Parent table names, deduplicated.
 * @example
 * const parents = await fkParentTables(db, 'page_errors');
 * expect(parents.has('content_items')).toBe(true);
 * expect(parents.has('pages')).toBe(false);
 */
export async function fkParentTables(db: Knex, table: string): Promise<Set<string>> {
	const rows: { table: string }[] = await db
		.select('table')
		.from(db.raw('pragma_foreign_key_list(?)', [table]));
	return new Set(rows.map((row) => row.table));
}
