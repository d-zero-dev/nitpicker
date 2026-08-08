import knex from 'knex';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

/**
 * Provisions an in-memory SQLite database with:
 *
 * - A minimal subset of the legacy write model (`pages`, `resources`,
 *   `anchors`, `images`, `resources-referrers`, `page_html_ref`,
 *   `page_html_blobs`) — only the columns the 0.13 populates
 *   actually read.
 * - The 0.13 ref / header tables (via {@link createRefTables}).
 * - The 0.13 entity tables (via {@link createEntityTables}).
 * - The 0.13 adjunct tables (via {@link createAdjunctTables}) — required
 *   because `content_items.dedupe_cap_event_id REFERENCES
 *   dedupe_cap_events(id)`; under `PRAGMA foreign_keys = ON` (enabled
 *   below), inserting into `content_items` fails with `no such table:
 *   dedupe_cap_events` if the adjunct tables were skipped. `initSchema`
 *   always calls both create functions together, so this mirrors a real
 *   archive's actual schema rather than an artificially incomplete one.
 *
 * Every 0.13 populate spec calls this to obtain a fresh DB. The
 * caller is responsible for `db.destroy()` (spec `afterEach`).
 *
 * `PRAGMA foreign_keys = ON` is enabled at setup time so specs mirror
 * the migration script's execution mode. `content_items.redirect_dest_id`'s
 * DEFERRABLE FK is enforced at COMMIT, so specs that exercise the
 * self-reference must run their inserts inside a `db.transaction`
 * boundary (see `populate-content-items.spec.ts`'s redirect test) —
 * bare inserts would trip the FK immediately.
 * @returns Connected Knex instance.
 */
export async function setupMigrationDb(): Promise<ReturnType<typeof knex>> {
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
	});
	await db.raw('PRAGMA foreign_keys = ON');
	await db.schema.createTable('pages', (t) => {
		t.increments('id');
		t.string('url').notNullable();
		t.integer('redirectDestId').nullable();
		t.boolean('scraped').notNullable();
		t.boolean('isTarget').notNullable();
		t.boolean('isExternal');
		t.integer('status');
		t.string('statusText');
		t.string('contentType').nullable();
		t.integer('contentLength').nullable();
		t.json('responseHeaders').nullable();
		t.string('lang');
		t.string('dir');
		t.string('charset');
		t.string('baseHref');
		t.text('viewport_raw');
		t.string('themeColor');
		t.string('applicationName');
		t.string('author');
		t.string('generator');
		t.string('publisher');
		t.string('title');
		t.text('description');
		t.text('keywords');
		t.text('robots_raw');
		t.integer('robots_noindex');
		t.integer('robots_nofollow');
		t.integer('robots_noarchive');
		t.integer('robots_noimageindex');
		t.string('googlebot');
		t.string('canonical');
		t.string('amphtml');
		t.string('manifest');
		t.string('icon_href');
		t.string('appleTouchIcon_href');
		t.string('og_type');
		t.string('og_title');
		t.string('og_url');
		t.string('og_site_name');
		t.text('og_description');
		t.string('og_image');
		t.string('og_image_alt');
		t.string('og_image_width');
		t.string('og_image_height');
		t.string('og_locale');
		t.string('og_article_published_time');
		t.string('og_article_modified_time');
		t.string('twitter_card');
		t.string('twitter_site');
		t.string('twitter_creator');
		t.string('twitter_title');
		t.text('twitter_description');
		t.string('twitter_image');
		t.string('fb_app_id');
		t.string('verification_google');
		t.integer('formatDetection_telephone');
		t.integer('firstCrawledAt');
		t.integer('lastCrawledAt');
		t.integer('tag_count');
		t.integer('jsonld_count');
		t.text('tags_providers_csv');
		t.json('meta_extras');
		t.boolean('isSkipped');
		t.string('skipReason');
		t.integer('order');
		t.string('source').notNullable().defaultTo('crawled');
	});
	await db.schema.createTable('resources', (t) => {
		t.increments('id');
		t.string('url').notNullable();
		t.boolean('isExternal');
		t.integer('status');
		t.string('statusText');
		t.string('contentType').nullable();
		t.integer('contentLength').nullable();
		t.string('compress').nullable();
		t.string('cdn').nullable();
		t.json('responseHeaders').nullable();
		t.string('source').notNullable().defaultTo('crawled');
	});
	await db.schema.createTable('anchors', (t) => {
		t.increments('id');
		t.integer('pageId').notNullable();
		t.integer('hrefId').notNullable();
		t.string('hash');
		t.string('textContent').nullable();
	});
	await db.schema.createTable('images', (t) => {
		t.increments('id');
		t.integer('pageId').notNullable();
		t.string('src').nullable();
		t.string('currentSrc').nullable();
		t.string('alt');
		t.float('width');
		t.float('height');
		t.integer('naturalWidth');
		t.integer('naturalHeight');
		t.boolean('isLazy');
		t.integer('viewportWidth');
		t.string('sourceCode');
	});
	await db.schema.createTable('resources-referrers', (t) => {
		t.increments('id');
		t.integer('resourceId').notNullable();
		t.integer('pageId').notNullable();
		t.unique(['resourceId', 'pageId']);
	});
	// `analysis_violations` is populated by analyze plugins downstream of
	// crawl; the migration itself does not create rows here, but
	// `checkReaderParity` joins it to `pages` / `content_items` so the
	// table must exist so the parity SELECTs return 0-vs-0 (which the
	// parity check legitimately skips).
	await db.schema.createTable('analysis_violations', (t) => {
		t.increments('id');
		t.integer('page_id').notNullable();
		t.string('rule').notNullable();
		t.string('severity').notNullable();
		t.text('message');
	});
	// `populate-image-items.ts` reads HTML BLOBs via the same trx that
	// owns the outer populate transaction (see that file's JSDoc for the
	// deadlock the inline read avoids). Provide the two tables so specs
	// can seed rows or leave them empty (the reader returns `null` on a
	// missing row, matching the `getHtmlOfPageById` contract). Raw SQL
	// so the schema mirrors `init-schema.ts` exactly (`WITHOUT ROWID`,
	// `size_raw` + `size_stored`, `codec` CHECK).
	await db.raw(`
		CREATE TABLE page_html_blobs (
			hash         BLOB PRIMARY KEY,
			body         BLOB NOT NULL,
			codec        TEXT NOT NULL CHECK(codec IN ('zstd', 'none')),
			size_raw     INTEGER NOT NULL,
			size_stored  INTEGER NOT NULL
		) WITHOUT ROWID
	`);
	await db.raw(`
		CREATE TABLE page_html_ref (
			page_id  INTEGER PRIMARY KEY,
			hash     BLOB NOT NULL REFERENCES page_html_blobs(hash)
		) WITHOUT ROWID
	`);
	await createRefTables(db);
	await createEntityTables(db);
	await createAdjunctTables(db);
	return db;
}
