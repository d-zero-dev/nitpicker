import type { Knex } from 'knex';

/**
 * Adds the `page_meta.image_scan_desktop` / `page_meta.image_scan_mobile`
 * columns to archives created before this feature.
 *
 * `page_meta` is provisioned via a bare `CREATE TABLE IF NOT EXISTS` in
 * {@link import('./create-entity-tables.js').createEntityTables}, which
 * self-heals a *missing table* on every `initSchema` call but is a no-op
 * against an *existing* table — adding a column to the DDL string never
 * reaches an archive whose `page_meta` predates this change. Same catch-up
 * shape as {@link import('./migrate-page-meta-console-error-count.js').migratePageMetaConsoleErrorCount}.
 *
 * Both columns are added in the same migration since they are always
 * written together (one `@d-zero/beholder` `imageScan` result per page).
 * There is no backfill: a page that has never been re-scraped since this
 * feature shipped has no recorded outcome, so `NULL` (not attempted) is
 * already the correct value.
 *
 * Idempotent: adding a column that already exists is a no-op.
 * @param instance - The Knex query builder instance connected to the database.
 * @param onLog - Called instead of `console.error` when this migration
 *   actually applies (issue #294: a bare `console.error` here can fire
 *   while a `@d-zero/dealer` `Lanes`/`TaskList` display is mid-redraw during
 *   `Archive.open`, corrupting its cursor tracking). Falls back to
 *   `console.error` when omitted (direct/test callers).
 */
export async function migratePageMetaImageScan(
	instance: Knex,
	onLog?: (message: string) => void,
): Promise<void> {
	const hasPageMeta = await instance.schema.hasTable('page_meta');
	if (!hasPageMeta) {
		return;
	}
	const hasDesktopColumn = await instance.schema.hasColumn(
		'page_meta',
		'image_scan_desktop',
	);
	const hasMobileColumn = await instance.schema.hasColumn(
		'page_meta',
		'image_scan_mobile',
	);
	if (hasDesktopColumn && hasMobileColumn) {
		return;
	}
	await instance.schema.table('page_meta', (t) => {
		if (!hasDesktopColumn) {
			t.integer('image_scan_desktop');
		}
		if (!hasMobileColumn) {
			t.integer('image_scan_mobile');
		}
	});
	const message =
		'[migrate] page_meta.image_scan_desktop/image_scan_mobile columns added';
	if (onLog) {
		onLog(message);
	} else {
		// eslint-disable-next-line no-console
		console.error(message);
	}
}
