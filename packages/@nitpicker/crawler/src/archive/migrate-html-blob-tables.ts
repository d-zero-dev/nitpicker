import type { Knex } from 'knex';

/**
 * Adds the BLOB-backed HTML snapshot tables (`page_html_blobs` +
 * `page_html_ref`) to archives created before #75.
 *
 * A pre-#75 `.nitpicker` already has the `info` table, so `initSchema`'s
 * early-return path skips the freshly-introduced `CREATE TABLE`s. This
 * migration brings the schema forward idempotently so the read API stops
 * raising raw "no such table" errors against legacy archives. It does NOT
 * touch the `pages.html` column or backfill the new tables from the
 * archive's `snapshot-html.zip`: that data migration belongs to the
 * `scripts/migrate-to-0.10.mjs` one-shot, which can run whenever the
 * user is ready to commit the (multi-hour) CPU cost.
 *
 * Outcome on a legacy archive that has NOT yet been data-migrated:
 *   - new tables exist but are empty,
 *   - `getHtmlOfPageById` returns `null` for every page (no row in `page_html_ref`),
 *   - viewer / MCP / analyze plugins see "snapshot unavailable" instead of crashing.
 *
 * The migration prints a one-line notice when it runs so the user knows
 * the archive was upgraded in place.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateHtmlBlobTables(instance: Knex): Promise<void> {
	const hasBlobs = await instance.schema.hasTable('page_html_blobs');
	if (hasBlobs) {
		return;
	}
	const hasPages = await instance.schema.hasTable('pages');
	if (!hasPages) {
		// Empty archive; initSchema will create both tables on the
		// fresh-DB path. Nothing to migrate.
		return;
	}
	await instance.raw(`
		CREATE TABLE page_html_blobs (
			hash         BLOB PRIMARY KEY,
			body         BLOB NOT NULL,
			codec        TEXT NOT NULL CHECK(codec IN ('zstd', 'none')),
			size_raw     INTEGER NOT NULL,
			size_stored  INTEGER NOT NULL
		) WITHOUT ROWID
	`);
	await instance.raw(`
		CREATE TABLE page_html_ref (
			page_id  INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
			hash     BLOB NOT NULL REFERENCES page_html_blobs(hash)
		) WITHOUT ROWID
	`);
	await instance.raw('CREATE INDEX idx_page_html_ref_hash ON page_html_ref(hash)');
	// eslint-disable-next-line no-console
	console.error(
		'[migrate] page_html_blobs / page_html_ref tables created. ' +
			'HTML snapshots are empty until `node scripts/migrate-to-0.10.mjs` is run on the original archive.',
	);
}
