import type { Knex } from 'knex';

/**
 * Adds the `content_items.dedupe_cap_event_id` column to archives created
 * before this feature.
 *
 * `content_items` is provisioned via a bare `CREATE TABLE IF NOT EXISTS` in
 * {@link import('./create-entity-tables.js').createEntityTables}, which
 * self-heals a *missing table* on every `initSchema` call but is a no-op
 * against an *existing* table — adding a column to the DDL string never
 * reaches an archive whose `content_items` predates this change. This
 * mirrors {@link import('./migrate-content-items-alias-of-id.js').migrateContentItemsAliasOfId}'s
 * catch-up: a `hasColumn`-guarded `ALTER TABLE` for the one column
 * `CREATE TABLE IF NOT EXISTS` cannot retrofit.
 *
 * Uses a raw `ALTER TABLE` (not the knex schema builder) so the retrofitted
 * column's `REFERENCES dedupe_cap_events(id) DEFERRABLE INITIALLY DEFERRED`
 * constraint matches the fresh-archive DDL bit-for-bit.
 *
 * Unlike `migrateContentItemsAliasOfId`, this migration never creates an
 * index for the column — `--dedupe-cap` is opt-in and the number of rows a
 * cap event ever marks is small (capped shapes × matching URLs), so there is
 * no measured hot path to justify one. See `createEntityTables`'s DDL
 * comment for the same reasoning.
 *
 * Only adds the column — it does not compute values for existing rows (they
 * stay `NULL`). That computation runs separately, from
 * `backfillDedupeCapEventId` during a viewer-read-model build, since it
 * requires recomputing `computeShapeKey` against every internal page's URL
 * and matching it against `dedupe_cap_events.shape_key`.
 *
 * Idempotent: adding the column is a no-op once it exists. Guards on
 * `content_items`'s existence defensively, though by the time this runs
 * (after `initSchema`, itself after `assertCompatibleVersion` rejects
 * pre-0.13 archives) the table is always present.
 * @param instance - The Knex query builder instance connected to the database.
 * @example
 * ```ts
 * await migrateContentItemsDedupeCapEventId(knex);
 * ```
 */
export async function migrateContentItemsDedupeCapEventId(instance: Knex): Promise<void> {
	const hasContentItems = await instance.schema.hasTable('content_items');
	if (!hasContentItems) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn(
		'content_items',
		'dedupe_cap_event_id',
	);
	if (!hasColumn) {
		await instance.raw(
			'ALTER TABLE content_items ADD COLUMN dedupe_cap_event_id INTEGER REFERENCES dedupe_cap_events(id) DEFERRABLE INITIALLY DEFERRED',
		);
		// eslint-disable-next-line no-console
		console.error('[migrate] content_items.dedupe_cap_event_id column added');
	}
}
