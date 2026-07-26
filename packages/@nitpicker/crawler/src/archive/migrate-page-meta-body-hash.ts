import type { Knex } from 'knex';

/**
 * Adds the `page_meta.body_hash` column to archives created before this
 * feature, then ensures its index exists.
 *
 * `page_meta` is provisioned via a bare `CREATE TABLE IF NOT EXISTS` in
 * {@link import('./create-entity-tables.js').createEntityTables}, which
 * self-heals a *missing table* on every `initSchema` call but is a no-op
 * against an *existing* table — adding a column to the DDL string never
 * reaches an archive whose `page_meta` predates this change. This mirrors
 * {@link import('./migrate-main-contents-columns.js').migrateMainContentsColumns}'s
 * catch-up: a `hasColumn`-guarded `ALTER TABLE` for the one column
 * `CREATE TABLE IF NOT EXISTS` cannot retrofit.
 *
 * The index is created here — unconditionally, after the column-add guard,
 * not inside `createEntityTables`'s DDL — for both a fresh archive (where
 * `body_hash` already exists from the DDL, so only the index still needs
 * creating) and a legacy archive (where the column is added just above,
 * then the index follows in the same call). `createEntityTables` runs
 * unconditionally on every archive open, including legacy archives that
 * still lack `body_hash` at that point; an unconditional
 * `CREATE INDEX ... body_hash` there would fail with `no such column` before
 * this migration ever runs. This function is the one place guaranteed to
 * run only after the column is confirmed present, for both archive kinds.
 *
 * Only adds the column and its index — it does not backfill values for
 * existing rows (they stay `NULL`). That backfill runs separately, from
 * `backfillBodyHashFromHtmlBlobs` during a viewer-read-model build, since it
 * requires decompressing every page's stored HTML and is too heavy to run on
 * every archive open.
 *
 * Idempotent: adding the column is a no-op once it exists (the index
 * creation always runs, but `IF NOT EXISTS` makes repeat runs a no-op too).
 * Guards on `page_meta`'s existence defensively, though by the time this
 * runs (after `initSchema`, itself after `assertCompatibleVersion` rejects
 * pre-0.13 archives) the table is always present.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migratePageMetaBodyHash(instance: Knex): Promise<void> {
	const hasPageMeta = await instance.schema.hasTable('page_meta');
	if (!hasPageMeta) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn('page_meta', 'body_hash');
	if (!hasColumn) {
		await instance.schema.table('page_meta', (t) => {
			t.binary('body_hash');
		});
		// eslint-disable-next-line no-console
		console.error('[migrate] page_meta.body_hash column added');
	}
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_page_meta_body_hash ON page_meta(body_hash)',
	);
}
