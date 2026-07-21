import type { Knex } from 'knex';

/**
 * Add the beholder `MainContentsData` / `ScrollHeightData` denormalised
 * aggregate columns to `page_meta` on archives created before this feature.
 *
 * `page_meta` is provisioned via a bare `CREATE TABLE IF NOT EXISTS` in
 * {@link import('./create-entity-tables.js').createEntityTables}, which
 * self-heals a *missing table* on every `initSchema` call but is a no-op
 * against an *existing* table — adding a column to the DDL string never
 * reaches an archive whose `page_meta` predates this change. This mirrors
 * {@link import('./migrate-info-roots.js').migrateInfoRoots}'s `info.roots`
 * catch-up: a `hasColumn`-guarded `ALTER TABLE` for the one column set that
 * `CREATE TABLE IF NOT EXISTS` cannot retrofit.
 *
 * Idempotent: a no-op once the columns exist. Guards on `page_meta`'s
 * existence defensively, though by the time this runs (after `initSchema`,
 * itself after `assertCompatibleVersion` rejects pre-0.13 archives) the
 * table is always present.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateMainContentsColumns(instance: Knex): Promise<void> {
	const hasPageMeta = await instance.schema.hasTable('page_meta');
	if (!hasPageMeta) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn(
		'page_meta',
		'main_content_word_count',
	);
	if (hasColumn) {
		return;
	}
	await instance.schema.table('page_meta', (t) => {
		t.string('main_content_node_name');
		t.string('main_content_id');
		t.string('main_content_role');
		t.string('main_content_selector');
		t.text('main_content_class_list');
		t.integer('main_content_word_count');
		t.integer('main_content_body_word_count');
		t.integer('main_content_heading_count');
		t.integer('main_content_image_count');
		t.integer('main_content_table_count');
		t.integer('main_content_button_count');
		t.integer('main_content_iframe_count');
		t.integer('main_content_video_count');
		t.integer('main_content_audio_count');
		t.integer('main_content_canvas_count');
		t.integer('scroll_height_desktop');
		t.integer('scroll_height_mobile');
	});
	// eslint-disable-next-line no-console
	console.error('[migrate] page_meta.main_content_* / scroll_height_* columns added');
}
