import type { Knex } from 'knex';

/**
 * Adds the `content_items.alias_of_id` column to archives created before
 * this feature, then ensures its index exists.
 *
 * `content_items` is provisioned via a bare `CREATE TABLE IF NOT EXISTS` in
 * {@link import('./create-entity-tables.js').createEntityTables}, which
 * self-heals a *missing table* on every `initSchema` call but is a no-op
 * against an *existing* table — adding a column to the DDL string never
 * reaches an archive whose `content_items` predates this change. This
 * mirrors {@link import('./migrate-page-meta-body-hash.js').migratePageMetaBodyHash}'s
 * catch-up: a `hasColumn`-guarded `ALTER TABLE` for the one column
 * `CREATE TABLE IF NOT EXISTS` cannot retrofit.
 *
 * Uses a raw `ALTER TABLE` (not the knex schema builder) so the retrofitted
 * column's `REFERENCES content_items(id) DEFERRABLE INITIALLY DEFERRED`
 * constraint matches the fresh-archive DDL bit-for-bit — the same
 * self-referencing shape as `redirect_dest_id` (see
 * `create-entity-tables.ts`'s JSDoc on why that FK must be deferred: a
 * lower-id row can reference a higher-id row within the same write).
 *
 * The index is created here — unconditionally, after the column-add guard,
 * not inside `createEntityTables`'s DDL — for both a fresh archive (where
 * `alias_of_id` already exists from the DDL, so only the index still needs
 * creating) and a legacy archive (where the column is added just above,
 * then the index follows in the same call). `createEntityTables` runs
 * unconditionally on every archive open, including legacy archives that
 * still lack `alias_of_id` at that point; an unconditional
 * `CREATE INDEX ... alias_of_id` there would fail with `no such column`
 * before this migration ever runs. This function is the one place
 * guaranteed to run only after the column is confirmed present, for both
 * archive kinds.
 *
 * Only adds the column and its index — it does not compute values for
 * existing rows (they stay `NULL`). That computation runs separately, from
 * `backfillAliasOfId` during a viewer-read-model build, since it requires
 * comparing every page's title and (for the trailing-slash tier) its
 * `body_hash` against every other page.
 *
 * Idempotent: adding the column is a no-op once it exists (the index
 * creation always runs, but `IF NOT EXISTS` makes repeat runs a no-op too).
 * Guards on `content_items`'s existence defensively, though by the time this
 * runs (after `initSchema`, itself after `assertCompatibleVersion` rejects
 * pre-0.13 archives) the table is always present.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateContentItemsAliasOfId(instance: Knex): Promise<void> {
	const hasContentItems = await instance.schema.hasTable('content_items');
	if (!hasContentItems) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn('content_items', 'alias_of_id');
	if (!hasColumn) {
		await instance.raw(
			'ALTER TABLE content_items ADD COLUMN alias_of_id INTEGER REFERENCES content_items(id) DEFERRABLE INITIALLY DEFERRED',
		);
		// eslint-disable-next-line no-console
		console.error('[migrate] content_items.alias_of_id column added');
	}
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_content_items_alias_of_id ON content_items(alias_of_id)',
	);
}
