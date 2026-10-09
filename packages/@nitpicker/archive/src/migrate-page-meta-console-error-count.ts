import type { Knex } from 'knex';

/**
 * Adds the `page_meta.console_error_count` column to archives created
 * before this feature (issue #228).
 *
 * `page_meta` is provisioned via a bare `CREATE TABLE IF NOT EXISTS` in
 * {@link import('./create-entity-tables.js').createEntityTables}, which
 * self-heals a *missing table* on every `initSchema` call but is a no-op
 * against an *existing* table — adding a column to the DDL string never
 * reaches an archive whose `page_meta` predates this change. Same
 * catch-up shape as {@link import('./migrate-page-meta-body-hash.js').migratePageMetaBodyHash}.
 *
 * Unlike `body_hash`, there is no separate backfill step: a page that has
 * never been re-scraped since this feature shipped has no
 * `page_console_logs` rows either, so `0` (the value `replaceConsoleLogs`
 * writes for a page with no error/pageerror entries) is already the
 * correct value, not a placeholder pending backfill.
 *
 * Idempotent: adding the column is a no-op once it exists.
 * @param instance - The Knex query builder instance connected to the database.
 * @param onLog - Called instead of `console.error` when this migration
 *   actually applies (issue #294: a bare `console.error` here can fire
 *   while a `@d-zero/dealer` `Lanes`/`TaskList` display is mid-redraw during
 *   `Archive.open`, corrupting its cursor tracking). Falls back to
 *   `console.error` when omitted (direct/test callers).
 */
export async function migratePageMetaConsoleErrorCount(
	instance: Knex,
	onLog?: (message: string) => void,
): Promise<void> {
	const hasPageMeta = await instance.schema.hasTable('page_meta');
	if (!hasPageMeta) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn('page_meta', 'console_error_count');
	if (!hasColumn) {
		await instance.schema.table('page_meta', (t) => {
			t.integer('console_error_count');
		});
		const message = '[migrate] page_meta.console_error_count column added';
		if (onLog) {
			onLog(message);
		} else {
			// eslint-disable-next-line no-console
			console.error(message);
		}
	}
}
