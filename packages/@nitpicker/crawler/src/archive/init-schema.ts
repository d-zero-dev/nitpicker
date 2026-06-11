import type { Knex } from 'knex';

/**
 * Initializes the archive database schema if tables do not exist.
 * Enables WAL journal mode and foreign keys, then creates all tables
 * (`info`, `pages`, `anchors`, `images`, `resources`, `resources-referrers`).
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function initSchema(instance: Knex) {
	const isExists = await instance.schema.hasTable('info');
	if (isExists) {
		return;
	}

	// Enable WAL mode and foreign keys for better performance and data integrity
	await instance.raw('PRAGMA journal_mode = WAL');
	await instance.raw('PRAGMA foreign_keys = ON');

	await instance.schema
		.createTable('info', (t) => {
			t.increments('id');
			t.string('version');
			t.string('name');
			t.string('baseUrl');
			t.json('roots');
			t.boolean('recursive');
			t.integer('interval');
			t.boolean('image');
			t.boolean('fetchExternal');
			t.integer('parallels');
			t.json('excludes');
			t.json('excludeKeywords');
			t.json('excludeUrls');
			t.integer('maxExcludedDepth');
			t.integer('retry');
			t.boolean('fromList');
			t.boolean('disableQueries');
			t.string('userAgent');
			t.boolean('ignoreRobots');
		})
		.createTable('pages', (t) => {
			t.increments('id');
			t.string('url', 8190).notNullable().unique();
			t.integer('redirectDestId').unsigned().references('pages.id').defaultTo(null);
			t.boolean('scraped').notNullable();
			t.boolean('isTarget').notNullable();
			t.boolean('isExternal');
			t.integer('status');
			t.string('statusText');
			t.string('contentType').nullable();
			t.integer('contentLength').unsigned().nullable();
			t.json('responseHeaders').nullable();
			t.string('lang');
			t.string('title');
			t.string('description');
			t.string('keywords');
			t.boolean('noindex');
			t.boolean('nofollow');
			t.boolean('noarchive');
			t.string('canonical');
			t.string('alternate');
			t.string('og_type');
			t.string('og_title');
			t.string('og_site_name');
			t.string('og_description');
			t.string('og_url');
			t.string('og_image');
			t.string('twitter_card');
			t.string('html');
			t.boolean('isSkipped');
			t.string('skipReason');
			t.integer('order').unsigned().nullable();

			t.index('isExternal');
			t.index('contentType');
			t.index('scraped');
			t.index('redirectDestId');
			t.index('order');
		})
		.createTable('anchors', (t) => {
			t.increments('id');
			t.integer('pageId').notNullable().unsigned().references('pages.id');
			t.integer('hrefId').notNullable().unsigned().references('pages.id');
			t.string('hash');
			t.string('textContent').nullable();

			t.index('pageId');
			t.index('hrefId');
		})
		.createTable('images', (t) => {
			t.increments('id');
			t.integer('pageId').notNullable().unsigned().references('pages.id');
			t.string('src', 8190);
			t.string('currentSrc', 8190);
			t.string('alt');
			t.float('width').unsigned().notNullable();
			t.float('height').unsigned().notNullable();
			t.integer('naturalWidth').unsigned().notNullable();
			t.integer('naturalHeight').unsigned().notNullable();
			t.boolean('isLazy');
			t.integer('viewportWidth').unsigned().notNullable();
			t.string('sourceCode');

			t.index('pageId');
		})
		.createTable('resources', (t) => {
			t.increments('id');
			t.string('url', 8190).notNullable().unique();
			t.boolean('isExternal');
			t.integer('status');
			t.string('statusText');
			t.string('contentType').nullable();
			t.integer('contentLength').unsigned().nullable();
			t.string('compress').nullable();
			t.string('cdn').nullable();
			t.json('responseHeaders').nullable();
		})
		.createTable('resources-referrers', (t) => {
			t.increments('id');
			t.integer('resourceId').notNullable().unsigned().references('resources.id');
			t.integer('pageId').notNullable().unsigned().references('pages.id');

			t.unique(['resourceId', 'pageId']);
			t.index('resourceId');
			t.index('pageId');
		})
		.createTable('page_errors', (t) => {
			// Records partial scrape failures (e.g. a viewport switch that
			// detaches the frame and trips beholder's @retryable into the
			// `retryExhausted` phase). A page can have zero or more rows here
			// in addition to its normal `pages` entry — the page itself is
			// considered successfully scraped, but image capture or another
			// secondary step failed for at least one device preset.
			t.increments('id');
			t.integer('pageId').notNullable().unsigned().references('pages.id');
			t.string('phase').notNullable();
			t.text('message').notNullable();
			t.integer('createdAt').notNullable();

			t.index('pageId');
		});
}
