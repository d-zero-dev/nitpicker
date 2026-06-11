import type { Knex } from 'knex';

/**
 * Adds the `page_errors` table to archives created before partial-failure
 * recording landed.
 *
 * `page_errors` captures secondary scrape failures (e.g. a viewport switch
 * that detaches the frame and surfaces `retryExhausted`) so they show up in
 * the archive instead of being lost to stdout logs. Older `.nitpicker` files
 * predate this table; this migration creates it idempotently.
 *
 * Idempotent: when the table already exists, the function exits without
 * touching the schema or writing to stderr. When it has to run, a single
 * notice is written so the user knows the file was upgraded.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migratePageErrors(instance: Knex): Promise<void> {
	const hasTable = await instance.schema.hasTable('page_errors');
	if (hasTable) {
		return;
	}
	const hasPages = await instance.schema.hasTable('pages');
	if (!hasPages) {
		// Empty archive; the regular initSchema path will create both tables.
		return;
	}
	await instance.schema.createTable('page_errors', (t) => {
		t.increments('id');
		t.integer('pageId').notNullable().unsigned().references('pages.id');
		t.string('phase').notNullable();
		t.text('message').notNullable();
		t.integer('createdAt').notNullable();

		t.index('pageId');
	});
	// eslint-disable-next-line no-console
	console.error('[migrate] page_errors table created');
}
