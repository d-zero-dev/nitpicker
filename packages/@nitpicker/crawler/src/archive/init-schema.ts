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
	// connection. Required for ON DELETE CASCADE on `page_html_ref`,
	// `page_tags`, and `page_jsonld` to fire.
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
 * - **Meta columns (v2)**: pages carries ~47 flat columns derived from
 *   beholder 3.0.0's nested Meta shape (`canonical`, `og_*`, `twitter_*`,
 *   `robots_*`, document basics, editorial fields) plus a `meta_extras`
 *   JSON column for everything not flattened. URL-shaped columns are
 *   absolutised against the page URL before write (see
 *   `archive/meta/derive-flat-from-meta.ts`).
 * - **Denormalised aggregates** (`tag_count`, `jsonld_count`,
 *   `tags_providers_csv`): computed at write time from `meta.tags` /
 *   `meta.jsonLd` to avoid N+1 GROUP BY at Sheets-render / page-detail time.
 *   Plan: "ファイルサイズが多少増えてもいいから取り出しパフォーマンスを優先".
 * - **Per-page timestamps** (`firstCrawledAt`, `lastCrawledAt`): UNIX ms.
 *   Written by `#insertPage` on INSERT (`first = last = now`) and UPDATE
 *   (`last = now`, `first` preserved). `resetFailedPages` deliberately
 *   leaves them alone so failure-reset does not erase the last-success
 *   record.
 * - **`page_tags`** (Wappalyzer): per-provider × external-id row shape, plus
 *   `categories`/`sources` JSON columns. Compound indexes
 *   `(provider, externalId)` / `(provider, pageId)` are pre-built for the
 *   Phase 2+ "find duplicate IDs across pages" and "list pages using
 *   provider X" hot paths — Phase 1 read perf > storage cost trade-off.
 * - **`page_jsonld`** (JSON-LD / SpeculationRules): one row per
 *   `<script type="application/ld+json">` or `<script type="speculationrules">`.
 *   `raw` is stored uncompressed (SQLite overflow pages handle large rows);
 *   if cross-archive bulk export becomes a use case, add a `codec` column
 *   à la `page_html_blobs`. Compound `(type, pageId)` accelerates streaming
 *   `list_pages_by_jsonld_type` JOINs.
 * - **HTML snapshots** (`page_html_blobs` + `page_html_ref`): unchanged
 *   from v1. zstd-compressed BLOBs keyed by SHA-256 for content-addressable
 *   dedup. WITHOUT ROWID via raw SQL because knex's schema builder cannot
 *   express it.
 * - **PRAGMA `page_size` and `journal_mode`** are set BEFORE any
 *   `CREATE TABLE` because SQLite only honors `page_size` changes against
 *   an empty database, and `journal_mode = WAL` is persistent. Other
 *   per-connection PRAGMAs live in {@link applyConnectionPragmas}.
 *
 * Pre-0.10 → 0.10 migration is intentionally absent. `assertCompatibleVersion`
 * (called before `initSchema`) rejects pre-0.10 archives with a friendly
 * error pointing the operator at `scripts/migrate-to-0.10.mjs`; `v0.x`
 * policy allows breaking changes.
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

			// Denormalised aggregates (written at scrape time, see
			// archive/meta/compute-page-denormalized.ts)
			t.integer('tag_count');
			t.integer('jsonld_count');
			t.text('tags_providers_csv');

			// Catch-all JSON for nested Meta sub-objects not flattened above
			t.json('meta_extras');

			// Crawl lifecycle
			t.boolean('isSkipped');
			t.string('skipReason');
			t.integer('order').unsigned().nullable();

			// Provenance: which channel inserted this row. Values:
			//   'crawled'              — discovered via the recursive crawl from one of `info.roots`
			//   'inventory-seed'       — supplied directly by `crawl --inventory` URL list
			//   'inventory-discovered' — found by following links from an `inventory-seed` page
			// Used by `listIsolatedPages` only for badge display; isolation
			// itself is judged by `anchors.hrefId IS NULL`, not by source.
			t.string('source').notNullable().defaultTo('crawled');

			t.index('isExternal');
			t.index('contentType');
			t.index('scraped');
			t.index('redirectDestId');
			t.index('order');
			// Phase 1: noindex filter (list_pages) and og:type filter
			// (analytics) are the only new flat-column filters with enough
			// selectivity to benefit from an index. `lang` has cardinality 1
			// on mono-language sites (D-Zero's typical customer) so it is
			// skipped.
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
			// See `pages.source` for the provenance taxonomy. `inventory-seed`
			// rows here come from non-HTML URLs handed in by
			// `crawl --inventory`; `inventory-discovered` rows are sub-resources
			// pulled in while puppeteer rendered an inventory-seed page.
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
		})
		.createTable('page_tags', (t) => {
			// Wappalyzer-derived technology detection. One row per
			// (provider × externalId) tuple per page. `category` is the first
			// element of `categories`; the full list lives in the JSON
			// `categories` column. `sources` records where the provider was
			// detected (script-src / inline / iframe-src / window-global / …).
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
		})
		.createTable('page_jsonld', (t) => {
			// JSON-LD and SpeculationRules entries captured from
			// `<script type="application/ld+json">` and
			// `<script type="speculationrules">`. `kind` discriminates; `type`
			// is the top-level `@type` extracted by classify-jsonld-type for
			// indexable filtering. `raw` is stored uncompressed; SQLite
			// overflow pages handle multi-KB JSON bodies transparently.
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
		})
		.createTable('inventory_runs', (t) => {
			// One row per successful `--inventory <list>` invocation. The
			// archive's audit log of "when did we apply which deploy list
			// at what scale". `.bak` is removed on success so this table
			// is the only durable provenance record. Schema rationale +
			// non-goals live in {@link migrateInventoryRuns}.
			t.increments('id');
			t.string('ran_at').notNullable();
			t.string('list_label').nullable();
			t.string('source_file_sha256', 64).nullable();
			t.integer('total_lines').nullable();
			t.integer('new_pages').nullable();
			t.integer('new_resources').nullable();
			t.integer('scope_skipped').nullable();
			t.text('notes').nullable();
			t.index('ran_at');
		});

	// ON DELETE CASCADE and compound indexes for the new tables. Knex's
	// schema builder can't express CASCADE / compound indexes inline in a
	// way that round-trips through libsql consistently, so we use raw SQL
	// to mirror the `page_html_ref` pattern.
	await instance.raw(
		'CREATE INDEX page_tags_provider_extId ON page_tags(provider, externalId)',
	);
	await instance.raw(
		'CREATE INDEX page_tags_provider_pageId ON page_tags(provider, pageId)',
	);
	await instance.raw('CREATE INDEX page_jsonld_type_pageId ON page_jsonld(type, pageId)');

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

	// Composite covering index for the default Pages-view filter + url-ordered
	// scan. Without it, `listPages` on a 400k-row archive runs ~15s per page
	// click (SCAN pages USING pages_scraped_index + TEMP B-TREE FOR ORDER BY);
	// with it, the same query runs ~45ms (368x speedup, confirmed via
	// `scripts/bench-partial-listfilter.mjs` against a real customer archive).
	// The same index also serves `listIsolatedPages`, `listIsolatedClusters`,
	// and `getSummary`'s HTML-page counts.
	//
	// **DO NOT RUN `ANALYZE` ON .nitpicker ARCHIVES.** With ANALYZE statistics
	// available, the planner switches the JOIN paths in `listLinks`,
	// `getLinkGraph`, and `listPageLinks` to use this index for source/dest
	// seeks (SCAN dest → SEARCH anchors → SEARCH source) instead of the
	// existing `SCAN anchors → rowid seek` plan. That regression takes those
	// queries from ~15s to ~500s (33x worse). The unanalyzed-table heuristic
	// happens to pick the right plan for the joins while still picking the new
	// index for `listPages` because the column order (`scraped, redirectDestId,
	// url, contentType`) exactly matches the WHERE+ORDER predicates. If a
	// future change adds `ANALYZE` anywhere in the crawler / viewer / MCP /
	// migration paths, this index must be re-evaluated first.
	await instance.raw(
		'CREATE INDEX idx_pages_listfilter ON pages(scraped, redirectDestId, url, contentType)',
	);
}
