import type { Knex } from 'knex';

/**
 * Adds the `inventory_runs` audit-log table to archives created before
 * Phase 1 of inventory run tracking shipped.
 *
 * `inventory_runs` records one row per successful `--inventory <list>`
 * invocation, capturing which deploy list was applied when and what
 * scale it operated at. The motivation is operational: client /
 * director conversations repeatedly ask "did you apply last month's
 * list" / "we didn't double-apply, right" — the archive itself had no
 * trace of inventory passes (`.bak` is unlinked on success), so this
 * table is the durable provenance record.
 *
 * Schema details (column semantics, NULL policy, index) live in
 * {@link initSchema} — this migration only re-creates the table shape
 * on legacy archives so the rest of the codebase can treat the table
 * as always-present once a writer connection has opened the file.
 *
 * Idempotent: when the table already exists, the function exits
 * silently — the `[migrate] inventory_runs table created` stderr line
 * fires **only** on the first run against a legacy archive, matching
 * the established pattern of `migrate-page-errors.ts` /
 * `migrate-crawl-errors.ts`. Operators can rely on the log line as a
 * stable "first time this archive saw Phase 1 schema" event marker.
 * Empty archives (no `pages` table) are skipped entirely; the regular
 * `initSchema` path provisions them at first crawl.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateInventoryRuns(instance: Knex): Promise<void> {
	const hasTable = await instance.schema.hasTable('inventory_runs');
	if (hasTable) {
		return;
	}
	const hasPages = await instance.schema.hasTable('pages');
	if (!hasPages) {
		// Empty archive; the regular initSchema path will create the table.
		return;
	}
	await instance.schema.createTable('inventory_runs', (t) => {
		t.increments('id');
		t.string('ran_at').notNullable();
		t.string('list_label').nullable();
		t.string('source_file_sha256', 64).nullable();
		t.integer('total_lines').nullable();
		t.integer('new_pages').nullable();
		t.integer('new_resources').nullable();
		t.integer('scope_skipped').nullable();
		t.text('notes').nullable();
		t.index('ran_at');
	});
	// eslint-disable-next-line no-console
	console.error('[migrate] inventory_runs table created');
}
