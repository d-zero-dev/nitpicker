import type { Knex } from 'knex';

import { eachSplitted } from '../utils/array/each-splitted.js';

import { createAdjunctTables } from './create-adjunct-tables.js';
import { convertLegacyPageTagsToInserts } from './meta/technologies/convert-legacy-page-tags-to-inserts.js';

/**
 * The adjunct tables whose FK declarations may still point at the legacy
 * `pages(id)` on migrated archives. Only names are listed — the column
 * set is derived at runtime from the canonical table recreated by
 * {@link createAdjunctTables}, so a future column addition there cannot
 * silently drift from a hardcoded list (a missing column in the staged
 * copy fails the copy-back INSERT loudly instead of dropping data).
 *
 * `page_tags` is deliberately NOT here — it has no current-schema
 * equivalent to retarget onto (removed in favor of `technology_signals` /
 * `page_technologies`). {@link retargetLegacyFkTables} handles it as a
 * special case: convert its rows, then drop it outright rather than
 * recreating it. See that function's JSDoc.
 */
const RETARGET_TABLES: readonly string[] = [
	'page_html_ref',
	'page_jsonld',
	'page_errors',
	'analysis_violations',
];

/**
 * Canonical columns that a staged (pre-migration) table may legitimately
 * lack because {@link createAdjunctTables}'s DDL gained them after the
 * table was first lazily provisioned on the input archive (`analysis_violations`
 * predates its `line`/`col` columns — issue #225). Missing columns listed
 * here are copied back as `NULL` instead of aborting the migration; this is
 * safe only because the column did not exist when the staged data was
 * written, so `NULL` is the only value it could ever have had. Any other
 * canonical column absent from the staged table still aborts the copy (see
 * {@link retargetLegacyFkTables} JSDoc) — that case must stay loud, since a
 * genuine rename/drop cannot be told apart from benign schema growth by
 * column existence alone.
 */
const NULLABLE_ON_RETARGET: Readonly<Record<string, readonly string[]>> = {
	analysis_violations: ['line', 'col'],
};

/**
 * Rewrites the FK declarations of the adjunct tables from the legacy
 * `pages(id)` to `content_items(id)` by rebuilding each table, AND converts
 * `page_tags` (if present) into `technology_signals` / `page_technologies`.
 * SQLite has no `ALTER TABLE … DROP CONSTRAINT`, so the only way to change
 * an FK target is to recreate the table:
 *
 * 1. Stage each {@link RETARGET_TABLES} table's rows into a constraint-free
 *    `<table>__retarget` copy (`CREATE TABLE … AS SELECT *`) and drop the
 *    original, freeing its index names. `page_tags`, if present, is read
 *    into memory here too (converted via `convertLegacyPageTagsToInserts` —
 *    the same helper `migrate-page-tags-to-page-technologies.ts` uses for
 *    already-0.13+ archives) but NOT staged the same way: it has no
 *    current-schema table to retarget onto, so there is nothing to copy
 *    back — only something to drop, once its data lives in the tables
 *    from step 2.
 * 2. Recreate every {@link RETARGET_TABLES} table through
 *    {@link createAdjunctTables} — the same DDL fresh archives get, so
 *    migrated archives end up identical in shape and index naming.
 *    Rebuilding the DDL inline here instead would recreate the exact
 *    drift this function repairs. This same call also creates
 *    `technology_signals` / `page_technologies` (idempotent
 *    `hasTable`-guarded DDL — a no-op if a prior partial run already
 *    created them).
 * 3. Copy the staged {@link RETARGET_TABLES} rows back using the recreated
 *    table's own column list (read via `pragma_table_info`). A column the
 *    canonical DDL has but the input archive lacks aborts the INSERT with
 *    a clear error — never a silent data drop. The converted `page_tags`
 *    signals/technologies are inserted here too, then `page_tags` itself
 *    is dropped (not recreated).
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

	// `page_tags` has no current-schema table to retarget onto (removed —
	// see the module JSDoc), so its rows are converted to
	// `technology_signals` / `page_technologies` shape HERE, while
	// `page_tags` still exists, then only dropped (not staged/recreated)
	// after `createAdjunctTables` below provisions the tables that will
	// receive them.
	const hasLegacyPageTags = await trx.schema.hasTable('page_tags');
	const legacyTagRows: Array<{
		pageId: number;
		provider: string;
		version: string | null;
		confidence: number | null;
		categories: unknown;
	}> = hasLegacyPageTags
		? await trx
				.select('pageId', 'provider', 'version', 'confidence', 'categories')
				.from('page_tags')
		: [];

	await createAdjunctTables(trx);

	for (const table of staged) {
		const columns: { name: string }[] = await trx
			.select('name')
			.from(trx.raw('pragma_table_info(?)', [table]));
		const stagedColumns: { name: string }[] = await trx
			.select('name')
			.from(trx.raw('pragma_table_info(?)', [`${table}__retarget`]));
		const stagedColumnNames = new Set(stagedColumns.map((column) => column.name));
		const nullableOnRetarget = NULLABLE_ON_RETARGET[table] ?? [];
		const insertColumnList = columns.map((column) => `"${column.name}"`).join(', ');
		const selectColumnList = columns
			.map((column) =>
				!stagedColumnNames.has(column.name) && nullableOnRetarget.includes(column.name)
					? `NULL AS "${column.name}"`
					: `"${column.name}"`,
			)
			.join(', ');
		await trx.raw(
			`INSERT INTO "${table}" (${insertColumnList}) SELECT ${selectColumnList} FROM "${table}__retarget"`,
		);
		await trx.raw(`DROP TABLE "${table}__retarget"`);
	}

	if (hasLegacyPageTags) {
		const { signalInserts, technologyInserts } =
			convertLegacyPageTagsToInserts(legacyTagRows);

		if (signalInserts.length > 0) {
			await eachSplitted(signalInserts, 100, async (chunk) => {
				await trx('technology_signals').insert(chunk);
			});
		}
		if (technologyInserts.length > 0) {
			await eachSplitted(technologyInserts, 100, async (chunk) => {
				await trx('page_technologies').insert(chunk);
			});
		}

		await trx.raw('DROP TABLE "page_tags"');
	}
}
