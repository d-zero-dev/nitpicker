import type { Knex } from 'knex';

/**
 * Applies the connection-level PRAGMAs that govern foreign-key enforcement
 * and BLOB-read performance. These are **per-connection** settings (libsql
 * resets them when a new connection is opened), so they must be reapplied
 * every time `Database.connect` runs — not just on first-time schema
 * initialization. Keeping them separate from `initSchema`'s one-shot path
 * also lets `page_size` (which only takes effect against an empty DB)
 * stay gated behind the existence check.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function applyConnectionPragmas(instance: Knex): Promise<void> {
	// Foreign-key enforcement defaults to OFF on every new SQLite
	// connection. Required for ON DELETE CASCADE on `page_html_ref` to fire.
	await instance.raw('PRAGMA foreign_keys = ON');
	await instance.raw('PRAGMA wal_autocheckpoint = 1000');
	// Negative value = KiB of memory (64 MiB). Helps large BLOB scans.
	await instance.raw('PRAGMA cache_size = -65536');
	// 256 MiB mmap window. SQLite falls back to read() past this so the
	// limit is a soft ceiling, not a hard one.
	await instance.raw('PRAGMA mmap_size = 268435456');
}

/**
 * Initializes the archive database schema if tables do not exist.
 *
 * Schema notes:
 *
 * - HTML snapshots are stored as zstd-compressed BLOBs inside the SQLite
 *   database itself (`page_html_blobs` + `page_html_ref`). The legacy
 *   `snapshot-html.zip` container is gone; this collapses the per-`--append`
 *   re-compression cost and unlocks straight `SELECT body` reads in stub /
 *   read-only mode.
 * - `page_html_blobs` is keyed by SHA-256 of the raw HTML bytes so identical
 *   bodies are stored once per archive (within-crawl dedup of 404s, error
 *   templates, etc.). This shape is also the natural fit for #23 (commit
 *   graph + cross-generation dedup): the table can be reused as-is and only
 *   the per-revision reference table is replaced.
 * - The `codec` column on `page_html_blobs` exists so future zstd → other
 *   migrations can flip individual blobs without a global rewrite; reads
 *   dispatch on it. A `CHECK` constraint pins it to the known set so a
 *   typo is rejected at write time, not at the next read.
 * - PRAGMA `page_size` and `journal_mode` are set BEFORE any `CREATE
 *   TABLE` because SQLite only honors `page_size` changes against an
 *   empty database, and `journal_mode = WAL` is persistent. Other
 *   per-connection PRAGMAs live in {@link applyConnectionPragmas}.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function initSchema(instance: Knex) {
	const isExists = await instance.schema.hasTable('info');
	if (isExists) {
		return;
	}

	// Page size must be set on an empty database file; once any data is
	// written, only VACUUM can change it. journal_mode is also one-shot
	// (persistent) and so stays here.
	await instance.raw('PRAGMA page_size = 16384');
	await instance.raw('PRAGMA journal_mode = WAL');

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
		})
		.createTable('crawl_errors', (t) => {
			// Structured form of the crawler-level `error` channel that otherwise
			// only lands in `error.log`. Unlike `page_errors` these are not tied to
			// a scraped page (the URL may be an external link that failed DNS, or
			// null for a process-level error), so there is no `pageId` FK and `url`
			// is nullable. The cause is NOT stored — it is classified on read from
			// `message` so older archives (which only have `error.log`) classify the
			// same way.
			t.increments('id');
			t.string('url', 8190).nullable();
			t.boolean('isExternal');
			t.text('message').notNullable();
			t.integer('createdAt').notNullable();
		});

	// Content-addressable HTML blob storage. Knex's schema builder doesn't
	// expose a WITHOUT ROWID toggle, so the BLOB tables are created via raw
	// SQL. WITHOUT ROWID keeps the rows packed inside the b-tree leaves
	// (no hidden rowid + secondary index pair), which matters for the blob
	// table where a 32-byte hash PK + multi-KB body is the dominant row
	// shape.
	await instance.raw(`
		CREATE TABLE page_html_blobs (
			hash         BLOB PRIMARY KEY,
			body         BLOB NOT NULL,
			codec        TEXT NOT NULL CHECK(codec IN ('zstd', 'none')),
			size_raw     INTEGER NOT NULL,
			size_stored  INTEGER NOT NULL
		) WITHOUT ROWID
	`);
	await instance.raw(`
		CREATE TABLE page_html_ref (
			page_id  INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
			hash     BLOB NOT NULL REFERENCES page_html_blobs(hash)
		) WITHOUT ROWID
	`);
	await instance.raw('CREATE INDEX idx_page_html_ref_hash ON page_html_ref(hash)');
}
