import type { Knex } from 'knex';

/**
 * Adds the `content_items.is_metadata_only` column to archives created
 * before this feature.
 *
 * `content_items` is provisioned via a bare `CREATE TABLE IF NOT EXISTS` in
 * {@link import('./create-entity-tables.js').createEntityTables}, which
 * self-heals a *missing table* on every `initSchema` call but is a no-op
 * against an *existing* table — adding a column to the DDL string never
 * reaches an archive whose `content_items` predates this change. This
 * mirrors {@link import('./migrate-content-items-dedupe-cap-event-id.js').migrateContentItemsDedupeCapEventId}'s
 * catch-up: a `hasColumn`-guarded `ALTER TABLE` for the one column
 * `CREATE TABLE IF NOT EXISTS` cannot retrofit.
 *
 * Unlike that migration, this column is `NOT NULL DEFAULT 0` (not nullable):
 * SQLite requires a `DEFAULT` on `ALTER TABLE ... ADD COLUMN ... NOT NULL`,
 * and the fresh-archive DDL carries the same `DEFAULT 0` so both paths stay
 * bit-for-bit identical (see `createEntityTables`'s DDL comment). Existing
 * rows backfill to `0` (not metadata-only) — a strict-pending row from
 * before this migration was always resumed as a full-scrape target anyway
 * (the bug this column fixes), so `0` preserves that prior behaviour rather
 * than silently reclassifying already-crawled archives.
 *
 * No index: the only reader (`getCrawlingState`) already filters to
 * `scraped = 0 AND is_external = 0` first, a small set. See
 * `createEntityTables`'s DDL comment for the same "no speculative index"
 * reasoning applied to `dedupe_cap_event_id`.
 *
 * Idempotent: adding the column is a no-op once it exists. Guards on
 * `content_items`'s existence defensively, though by the time this runs
 * (after `initSchema`, itself after `assertCompatibleVersion` rejects
 * pre-0.13 archives) the table is always present.
 * @param instance - The Knex query builder instance connected to the database.
 * @param onLog - Called instead of `console.error` when this migration
 *   actually applies (issue #294: a bare `console.error` here can fire
 *   while a `@d-zero/dealer` `Lanes`/`TaskList` display is mid-redraw during
 *   `Archive.open`, corrupting its cursor tracking). Falls back to
 *   `console.error` when omitted (direct/test callers).
 * @example
 * ```ts
 * await migrateContentItemsIsMetadataOnly(knex);
 * ```
 */
export async function migrateContentItemsIsMetadataOnly(
	instance: Knex,
	onLog?: (message: string) => void,
): Promise<void> {
	const hasContentItems = await instance.schema.hasTable('content_items');
	if (!hasContentItems) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn('content_items', 'is_metadata_only');
	if (!hasColumn) {
		await instance.raw(
			'ALTER TABLE content_items ADD COLUMN is_metadata_only INTEGER NOT NULL DEFAULT 0',
		);
		const message = '[migrate] content_items.is_metadata_only column added';
		if (onLog) {
			onLog(message);
		} else {
			// eslint-disable-next-line no-console
			console.error(message);
		}
	}
}
