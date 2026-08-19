import type { Knex } from 'knex';

/**
 * Adds the `page_meta.main_content_custom_element_count` column to archives
 * created before this feature.
 *
 * `page_meta` is provisioned via a bare `CREATE TABLE IF NOT EXISTS` in
 * {@link import('./create-entity-tables.js').createEntityTables}, which
 * self-heals a *missing table* on every `initSchema` call but is a no-op
 * against an *existing* table — adding a column to the DDL string never
 * reaches an archive whose `page_meta` predates this change. Same catch-up
 * shape as {@link import('./migrate-page-meta-console-error-count.js').migratePageMetaConsoleErrorCount}.
 *
 * Deliberately its own file rather than an addition to
 * {@link import('./migrate-main-contents-columns.js').migrateMainContentsColumns}:
 * that migration early-returns once its sentinel column
 * (`main_content_word_count`) already exists, so an archive that predates
 * only this one column (but already has the other sixteen main-content
 * columns) would never reach an appended `ALTER TABLE` inside it.
 *
 * No separate backfill: a page that has never been re-scraped since this
 * feature shipped stays `NULL` (unknown), which is correct — it is not
 * conflated with `0` (capture succeeded, zero custom elements found). See
 * {@link import('./meta/compute-main-contents-denormalized.js').computeMainContentsDenormalized}.
 *
 * Idempotent: adding the column is a no-op once it exists.
 * @param instance - The Knex query builder instance connected to the database.
 * @param onLog - Called instead of `console.error` when this migration
 *   actually applies (issue #294: a bare `console.error` here can fire
 *   while a `@d-zero/dealer` `Lanes`/`TaskList` display is mid-redraw during
 *   `Archive.open`, corrupting its cursor tracking). Falls back to
 *   `console.error` when omitted (direct/test callers).
 */
export async function migratePageMetaCustomElementCount(
	instance: Knex,
	onLog?: (message: string) => void,
): Promise<void> {
	const hasPageMeta = await instance.schema.hasTable('page_meta');
	if (!hasPageMeta) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn(
		'page_meta',
		'main_content_custom_element_count',
	);
	if (!hasColumn) {
		await instance.schema.table('page_meta', (t) => {
			t.integer('main_content_custom_element_count');
		});
		const message = '[migrate] page_meta.main_content_custom_element_count column added';
		if (onLog) {
			onLog(message);
		} else {
			// eslint-disable-next-line no-console
			console.error(message);
		}
	}
}
