import type { Knex } from 'knex';

import { createAdjunctTables } from './create-adjunct-tables.js';

/**
 * The adjunct tables whose FK declarations may still point at the legacy
 * `pages(id)` on migrated archives. Only names are listed — the column
 * set is derived at runtime from the canonical table recreated by
 * {@link createAdjunctTables}, so a future column addition there cannot
 * silently drift from a hardcoded list (a missing column in the staged
 * copy fails the copy-back INSERT loudly instead of dropping data).
 */
const RETARGET_TABLES: readonly string[] = [
	'page_html_ref',
	'page_tags',
	'page_jsonld',
	'page_errors',
	'analysis_violations',
];

/**
 * Rewrites the FK declarations of the adjunct tables from the legacy
 * `pages(id)` to `content_items(id)` by rebuilding each table. SQLite has
 * no `ALTER TABLE … DROP CONSTRAINT`, so the only way to change an FK
 * target is to recreate the table:
 *
 * 1. Stage each table's rows into a constraint-free `<table>__retarget`
 *    copy (`CREATE TABLE … AS SELECT *`) and drop the original, freeing
 *    its index names.
 * 2. Recreate every table through {@link createAdjunctTables} — the same
 *    DDL fresh archives get, so migrated archives end up identical in
 *    shape and index naming. Rebuilding the DDL inline here instead
 *    would recreate the exact drift this function repairs.
 * 3. Copy the staged rows back using the recreated table's own column
 *    list (read via `pragma_table_info`). A column the canonical DDL has
 *    but the input archive lacks aborts the INSERT with a clear error —
 *    never a silent data drop.
 *
 * A rename-based recipe (`ALTER TABLE x RENAME TO x__retarget`, skip
 * copy #1) is deliberately NOT used: SQLite keeps the renamed table's
 * indexes attached under their original names, which collide with the
 * index names {@link createAdjunctTables} declares — and the old index
 * names vary by the era of the archive's original provisioning, so
 * dropping them first would require enumerating unknown names. The
 * copy-out is cheap at these tables' scale (a handful of rows per page).
 *
 * Adjunct tables that do not exist on the input archive (e.g. a 0.10
 * archive that never ran `analyze`, so `analysis_violations` was never
 * lazily provisioned) are simply created empty by step 2.
 *
 * The migrated-archive PK-preservation contract makes the copy safe:
 * `content_items.id` reuses the legacy `pages.id` values verbatim, so
 * every staged `pageId` / `page_id` resolves to the same row under the
 * new FK target. Run inside a transaction with `PRAGMA foreign_keys = ON`
 * so the copy-back doubles as a row-level FK validation — a stale id
 * aborts the transaction here rather than surfacing later as a
 * `foreign_key_check` finding.
 * @param trx - Knex transaction on the archive being migrated
 *   (`scripts/migrate-to-0.13.mjs` is the caller).
 * @example
 * await db.transaction(async (trx) => {
 *   await retargetLegacyFkTables(trx);
 * });
 * // pragma_foreign_key_list('page_errors') now reports content_items.
 */
export async function retargetLegacyFkTables(trx: Knex): Promise<void> {
	const staged: string[] = [];
	for (const table of RETARGET_TABLES) {
		if (!(await trx.schema.hasTable(table))) {
			continue;
		}
		await trx.raw(`CREATE TABLE "${table}__retarget" AS SELECT * FROM "${table}"`);
		await trx.raw(`DROP TABLE "${table}"`);
		staged.push(table);
	}

	await createAdjunctTables(trx);

	for (const table of staged) {
		const columns: { name: string }[] = await trx
			.select('name')
			.from(trx.raw('pragma_table_info(?)', [table]));
		const columnList = columns.map((column) => `"${column.name}"`).join(', ');
		await trx.raw(
			`INSERT INTO "${table}" (${columnList}) SELECT ${columnList} FROM "${table}__retarget"`,
		);
		await trx.raw(`DROP TABLE "${table}__retarget"`);
	}
}
