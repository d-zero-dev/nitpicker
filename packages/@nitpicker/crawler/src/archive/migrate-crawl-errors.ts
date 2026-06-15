import type { Knex } from 'knex';

/**
 * Adds the `crawl_errors` table to archives created before structured capture
 * of the crawler-level `error` channel landed.
 *
 * `crawl_errors` records errors that previously only reached `error.log` (DNS
 * failures, connection resets, TLS problems, process-level errors), in a
 * queryable form so the `error-kinds` analysis can classify them without
 * parsing the text log. Older `.nitpicker` files predate this table; this
 * migration creates it idempotently. Existing archives stay empty until they
 * are crawled again (resume / append / retry), at which point new errors are
 * written here — analysis of pre-existing data falls back to parsing
 * `error.log`.
 *
 * Idempotent: when the table already exists, the function exits without
 * touching the schema or writing to stderr. It also skips empty archives (no
 * `pages` table), which the regular initSchema path will fully provision.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateCrawlErrors(instance: Knex): Promise<void> {
	const hasTable = await instance.schema.hasTable('crawl_errors');
	if (hasTable) {
		return;
	}
	const hasPages = await instance.schema.hasTable('pages');
	if (!hasPages) {
		// Empty archive; the regular initSchema path will create the table.
		return;
	}
	await instance.schema.createTable('crawl_errors', (t) => {
		t.increments('id');
		t.string('url', 8190).nullable();
		t.boolean('isExternal');
		t.text('message').notNullable();
		t.integer('createdAt').notNullable();
	});
	// eslint-disable-next-line no-console
	console.error('[migrate] crawl_errors table created');
}
