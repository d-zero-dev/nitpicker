import type { Knex } from 'knex';

/**
 * Provisions the pre-0.13 legacy table shape on a test database:
 * the five legacy write-model tables (`pages` / `anchors` / `images` /
 * `resources` / `resources-referrers`) plus the five adjunct tables in
 * their old form whose FK columns still point at `pages(id)`
 * (`page_html_ref` / `page_tags` / `page_jsonld` / `page_errors` /
 * `analysis_violations`, with their companion tables `page_html_blobs` /
 * `analysis_text_refs`).
 *
 * `initSchema` no longer creates any of these shapes — fresh archives get
 * neither the legacy write-model tables nor `pages(id)`-referencing
 * adjunct tables — so specs that exercise the migration input format
 * (`scripts/migrate-to-0.13.mjs` integration, `retargetLegacyFkTables`,
 * `dropLegacyTables`) build it through this helper instead. The DDL is a
 * verbatim copy of what pre-0.13 archives actually contain: the legacy
 * write-model tables match the pre-0.13 `initSchema`, and the adjunct
 * tables match the `scripts/migrate-to-0.10.mjs` / lazy-runtime-migration
 * output of that era.
 *
 * Any current-form adjunct tables already present (e.g. created by
 * `Archive.create()` on the current schema) are dropped first so the
 * old-FK versions can take their place — callers get a deterministic
 * "genuine pre-0.13 archive" shape regardless of how the underlying DB
 * was provisioned.
 * @param db - Knex connected to the test DB (or a transaction).
 * @example
 * await createRefTables(db);
 * await createEntityTables(db);
 * await setupLegacyFkDb(db);
 * await db('pages').insert({ url: 'https://example.com/', scraped: 1, isTarget: 1 });
 */
export async function setupLegacyFkDb(db: Knex): Promise<void> {
	// Children before parents so the drops never trip FK enforcement
	// when the caller has `PRAGMA foreign_keys = ON`.
	await db.raw('DROP TABLE IF EXISTS "page_html_ref"');
	await db.raw('DROP TABLE IF EXISTS "page_html_blobs"');
	await db.raw('DROP TABLE IF EXISTS "analysis_violations"');
	await db.raw('DROP TABLE IF EXISTS "analysis_text_refs"');
	await db.raw('DROP TABLE IF EXISTS "page_tags"');
	await db.raw('DROP TABLE IF EXISTS "page_jsonld"');
	await db.raw('DROP TABLE IF EXISTS "page_errors"');

	await db.schema
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

			// Document basics
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

			// Title / description / keywords (top-level Meta fields)
			t.string('title');
			t.text('description');
			t.text('keywords');

			// Robots
			t.text('robots_raw');
			t.integer('robots_noindex');
			t.integer('robots_nofollow');
			t.integer('robots_noarchive');
			t.integer('robots_noimageindex');
			t.string('googlebot');

			// Link (1:1 only — array shapes live in meta_extras)
			t.string('canonical', 8190);
			t.string('amphtml', 8190);
			t.string('manifest', 8190);
			t.string('icon_href', 8190);
			t.string('appleTouchIcon_href', 8190);

			// Open Graph
			t.string('og_type');
			t.string('og_title');
			t.string('og_url', 8190);
			t.string('og_site_name');
			t.text('og_description');
			t.string('og_image', 8190);
			t.string('og_image_alt');
			t.string('og_image_width');
			t.string('og_image_height');
			t.string('og_locale');
			t.string('og_article_published_time');
			t.string('og_article_modified_time');

			// Twitter
			t.string('twitter_card');
			t.string('twitter_site');
			t.string('twitter_creator');
			t.string('twitter_title');
			t.text('twitter_description');
			t.string('twitter_image', 8190);

			// One-offs
			t.string('fb_app_id');
			t.string('verification_google');
			t.integer('formatDetection_telephone');

			// Within-archive observation timestamps (UNIX ms)
			t.integer('firstCrawledAt');
			t.integer('lastCrawledAt');

			// Denormalised aggregates
			t.integer('tag_count');
			t.integer('jsonld_count');
			t.text('tags_providers_csv');

			// Catch-all JSON for nested Meta sub-objects not flattened above
			t.json('meta_extras');

			// Crawl lifecycle
			t.boolean('isSkipped');
			t.string('skipReason');
			t.integer('order').unsigned().nullable();

			t.string('source').notNullable().defaultTo('crawled');

			t.index('isExternal');
			t.index('contentType');
			t.index('scraped');
			t.index('redirectDestId');
			t.index('order');
			t.index('robots_noindex');
			t.index('og_type');
			t.index('source');
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
			t.string('source').notNullable().defaultTo('crawled');

			t.index('source');
		})
		.createTable('resources-referrers', (t) => {
			t.increments('id');
			t.integer('resourceId').notNullable().unsigned().references('resources.id');
			t.integer('pageId').notNullable().unsigned().references('pages.id');

			t.unique(['resourceId', 'pageId']);
			t.index('resourceId');
			t.index('pageId');
		});

	// Adjunct tables in their pre-0.13 shape: FK columns point at
	// `pages(id)` — the exact declarations that
	// `scripts/migrate-to-0.10.mjs` and the runtime lazy migrations of
	// that era produced.
	await db.schema.createTable('page_errors', (t) => {
		t.increments('id');
		t.integer('pageId').notNullable().unsigned().references('pages.id');
		t.string('phase').notNullable();
		t.text('message').notNullable();
		t.integer('createdAt').notNullable();

		t.index('pageId');
	});
	await db.schema.createTable('page_tags', (t) => {
		t.increments('id');
		t.integer('pageId')
			.notNullable()
			.unsigned()
			.references('pages.id')
			.onDelete('CASCADE');
		t.string('provider').notNullable();
		t.string('category');
		t.string('externalId');
		t.string('version');
		t.integer('confidence');
		t.json('categories');
		t.json('sources');

		t.index('pageId');
		t.index('provider');
		t.index('externalId');
	});
	await db.raw(
		'CREATE INDEX page_tags_provider_extId ON page_tags(provider, externalId)',
	);
	await db.raw('CREATE INDEX page_tags_provider_pageId ON page_tags(provider, pageId)');
	await db.schema.createTable('page_jsonld', (t) => {
		t.increments('id');
		t.integer('pageId')
			.notNullable()
			.unsigned()
			.references('pages.id')
			.onDelete('CASCADE');
		t.string('kind').notNullable();
		t.string('type');
		t.text('raw').notNullable();
		t.json('parsed');
		t.text('parseError');

		t.index('pageId');
		t.index('type');
	});
	await db.raw('CREATE INDEX page_jsonld_type_pageId ON page_jsonld(type, pageId)');
	await db.raw(`
		CREATE TABLE analysis_text_refs (
			id integer primary key,
			text text not null,
			sha256 text not null,
			unique(sha256, text)
		)
	`);
	await db.raw(`
		CREATE TABLE analysis_violations (
			id integer primary key,
			page_id integer not null references pages(id),
			validator text not null,
			severity text not null,
			rule text not null,
			message_text_id integer not null references analysis_text_refs(id),
			code_text_id integer references analysis_text_refs(id),
			page_url_sort_key text not null,
			message_sort_key text not null,
			code_sort_key text not null
		)
	`);
	await db.raw('CREATE INDEX av_url_order ON analysis_violations(page_url_sort_key, id)');
	await db.raw(
		'CREATE INDEX av_filter_url ON analysis_violations(validator, severity, rule, page_url_sort_key, id)',
	);
	await db.raw(
		'CREATE INDEX av_validator_url ON analysis_violations(validator, page_url_sort_key, id)',
	);
	await db.raw(
		'CREATE INDEX av_severity_url ON analysis_violations(severity, page_url_sort_key, id)',
	);
	await db.raw(
		'CREATE INDEX av_rule_url ON analysis_violations(rule, page_url_sort_key, id)',
	);
	await db.raw(
		'CREATE INDEX av_message_order ON analysis_violations(message_sort_key, id)',
	);
	await db.raw('CREATE INDEX av_code_order ON analysis_violations(code_sort_key, id)');
	await db.raw('CREATE INDEX av_page ON analysis_violations(page_id, id)');
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
			page_id  INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
			hash     BLOB NOT NULL REFERENCES page_html_blobs(hash)
		) WITHOUT ROWID
	`);
	await db.raw('CREATE INDEX idx_page_html_ref_hash ON page_html_ref(hash)');
}
