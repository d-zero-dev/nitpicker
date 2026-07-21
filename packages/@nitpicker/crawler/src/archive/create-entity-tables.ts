import type { Knex } from 'knex';

/**
 * Creates the 6 core entity and edge tables of the 0.13 format (issue #192).
 *
 * These are the normalised entity / edge tables that replace the legacy
 * write model (`pages`, `anchors`, `images`, `resources`, `resources-referrers`)
 * in the 0.13 format. This migration is purely additive DDL — no existing table
 * is modified and no row is inserted; the populate step
 * (`populateEntityTables`) fills the tables from the legacy sources.
 *
 * Tables created:
 *
 * - `content_items` — replaces `pages` (core columns). The remaining
 *   per-page metadata splits into `page_meta`.
 * - `page_meta` — page-specific metadata (title, description, meta tags,
 *   OpenGraph, Twitter, robots, denormalised aggregates, meta_extras JSON
 *   pointer). Split from `pages` so that filter / cursor queries against
 *   `content_items` scan a narrower row.
 * - `resource_items` — replaces `resources`. Identity URL splits into
 *   `url_id` (regular URLs) vs `url_blob_id` (large `data:` URIs, routed
 *   via `blob_refs`) — a resource's own URL is captured verbatim from
 *   the network layer and, unlike a page's URL, can legally be a large
 *   inline `data:` URI (e.g. a CSS `background-image` sub-resource).
 * - `anchor_edges` — replaces `anchors`. Deduped to distinct
 *   `(page_id, href_page_id)` pairs; `count` records how many instances
 *   were observed and `first_hash` / `first_text_id` capture the first
 *   instance's identity so the most important observable fact per link is
 *   preserved without every redundant row.
 * - `resource_ref_edges` — replaces `resources-referrers`. Structural
 *   rename with an added `count` column; `WITHOUT ROWID` because the
 *   composite PK `(resource_id, page_id)` is the natural clustering key
 *   and every column is small — the same reasoning as `page_html_blobs`.
 * - `image_items` — replaces `images`. `src` / `currentSrc` split into
 *   `*_url_id` (regular URLs) vs `*_blob_id` (large `data:` URIs, routed
 *   via `blob_refs`); `sourceCode` is replaced by `dom_path_text_id`,
 *   which the populate step derives from the `outerHTML` string.
 *
 * ### Key invariants
 *
 * **Same PK values as legacy.** `content_items.id`, `resource_items.id`,
 * and `image_items.id` reuse the exact PK values from `pages.id`,
 * `resources.id`, and `images.id` respectively. The populate step inserts
 * rows with explicit IDs so every existing FK reference in `page_errors`,
 * `page_tags`, `page_jsonld`, `page_html_ref`, and `resources-referrers`
 * (before it becomes `resource_ref_edges`) survives the switch without
 * any per-row UPDATE. `AUTOINCREMENT` is nevertheless applied on all four
 * entity PKs (`content_items` / `resource_items` / `anchor_edges` /
 * `image_items`) to match the legacy contract (`t.increments()` on
 * `pages` / `resources` / `anchors` / `images`) — this prevents rowid
 * reuse after DELETE, so external systems (analysis outputs, viewer
 * bookmarks, Sheets exports) keyed on `content_item.id` cannot be
 * silently reassigned to a different record.
 *
 * **UNIQUE(url_id) on content_items and resource_items.** The legacy
 * `pages.url UNIQUE` / `resources.url UNIQUE` guaranteed one row per
 * URL string. Under the new model the URL string is stored once in
 * `url_refs` and each entity references `url_refs.id` via `url_id` —
 * but `url_refs.url UNIQUE` only guarantees "one URL string → one
 * ref id", it does NOT prevent two entity rows from claiming the same
 * ref id. `UNIQUE(url_id)` on both `content_items` and `resource_items`
 * re-establishes that guarantee at the entity level — without it a
 * populate bug could attach two entity rows to the same URL, and every
 * by-URL reader would silently return an arbitrary one. The UNIQUE
 * constraint's auto-index also serves the by-URL seek path, so no
 * separate `CREATE INDEX ... ON content_items(url_id)` is needed.
 * `resource_items.url_id` is nullable (unlike `content_items.url_id`)
 * because a resource's identity URL can itself be blob-routed — see the
 * `resource_items url / blob mutual-exclusion CHECK` invariant below.
 * `UNIQUE` on a nullable SQLite column only dedups the non-NULL values,
 * so the guarantee still holds for every resource that does have a
 * `url_id`.
 *
 * **`redirect_dest_id` self-reference is DEFERRABLE INITIALLY DEFERRED.**
 * `content_items.redirect_dest_id` references `content_items(id)` (not
 * `pages(id)`), mirroring the legacy `pages.redirectDestId → pages.id`
 * self-reference. In the real archive shape, a redirect source can be
 * discovered as an anchor (assigned a low `pages.id`) BEFORE its
 * destination is crawled (higher `pages.id`), so a straight
 * `ORDER BY id ASC` populate would violate the FK on the source row.
 * Making the FK deferred lets the populate step commit all `content_items`
 * inserts inside one transaction without any per-row ordering
 * discipline — SQLite validates the constraint only at COMMIT time.
 *
 * **`page_meta.page_id` PK == FK ON DELETE CASCADE.** `page_meta` uses
 * `page_id` as both the primary key and the FK back to `content_items(id)`.
 * This is a 1:1 relation (every content_item has at most one meta row),
 * so a separate autoincrement id would only bloat the row. The cascade
 * mirrors the legacy `page_html_ref` / `page_tags` / `page_jsonld` FKs
 * to `pages(id)` so a future cleanup pass can DELETE from
 * `content_items` without leaving orphan meta rows.
 *
 * **`content_items.source` and `resource_items.source` DEFAULT 'crawled'.**
 * The legacy `pages.source` / `resources.source` columns were
 * `NOT NULL DEFAULT 'crawled'`, and multiple existing writer paths rely
 * on the default (redirect-source insert, per-chunk resource insert, and
 * `markBrowserScrape`). Preserving the default keeps those callsites
 * working when the 0.13 write path re-points them at the new tables — dropping
 * the default would turn a routine crawl into an immediate hard failure
 * the first time a callsite omits `source`.
 *
 * **`anchor_edges` dedup shape.** `unique(page_id, href_page_id)` enforces
 * the collapse from ≈ 13M legacy `anchors` rows to ≈ 9.7M `anchor_edges`
 * rows (~25 % reduction on the reference archive).
 * `first_hash` and `first_text_id` capture the anchor `hash` and
 * `textContent` of the FIRST instance encountered (lowest `anchors.id`
 * for the pair); duplicate observations are counted via `count` without
 * retaining their bodies. The UNIQUE constraint's auto-index on
 * `(page_id, href_page_id)` also serves any `WHERE page_id = ?` seek via
 * SQLite's leading-prefix rule, so no separate `CREATE INDEX ... ON
 * anchor_edges(page_id)` is needed; only the reverse-direction
 * `idx_anchor_edges_href` on `href_page_id` alone is added.
 *
 * **`image_items.dom_path_text_id NOT NULL`.** Every image row must
 * resolve to a `text_refs` entry describing its DOM position. The
 * image-items populate derives the path from `images.sourceCode` (the
 * stored `outerHTML`); an
 * image whose `sourceCode` is empty falls back to the synthetic label
 * `img[unknown]` (via the image-items populate) so the FK is never violated.
 *
 * **`image_items` src / blob mutual-exclusion CHECK.** `src_url_id` and
 * `src_blob_id` (and their `current_src_*` mirror) are separate nullable
 * columns because a `<img>` value can be either a plain URL or a large
 * `data:` URI. A single legacy `images.src` TEXT column could not
 * express the ambiguity; the new schema splits the two but adds a CHECK
 * so at most one slot per (src, currentSrc) pair is non-null. Without
 * the CHECK a populate bug or future writer could silently write both,
 * and the viewer would arbitrarily pick one to render.
 *
 * **`resource_items` url / blob mutual-exclusion CHECK.** Same rationale
 * as the image CHECK above, but stricter: `(url_id IS NULL) !=
 * (url_blob_id IS NULL)` requires EXACTLY one slot to be non-null (not
 * "at most one") because a resource — unlike an `<img>` that can
 * legitimately have neither `src` nor `currentSrc` — is always
 * identified by some URL. `resolveUrlOrBlob` (writer) /
 * `resolveUrlOrBlobFromMaps` (populate) are shared with `image_items`'
 * routing so the two entities never disagree on which values count as
 * "large data URI".
 *
 * **`page_meta.main_content_*` / `scroll_height_*` columns.** Denormalised
 * aggregates derived from beholder's `MainContentsData` / `ScrollHeightData`
 * (word/element counts, desktop+mobile scroll height), following the same
 * write-once-at-scrape-time pattern as `tag_count` / `jsonld_count` so list
 * / detail reads never re-derive them from the per-page child tables
 * (`page_main_content_headings` etc., see `create-adjunct-tables.ts`).
 * `main_content_node_name` / `_id` / `_role` / `_selector` / `_class_list`
 * identify the detected main-content element; unlike `title_text_id` /
 * `description_text_id` these are stored as plain `TEXT` rather than routed
 * through `text_refs` — the values are page-specific diagnostics with low
 * cross-page reuse, so the ref-table dedup machinery would add write-path
 * cost without a corresponding storage win. `main_content_class_list` holds
 * a JSON-encoded string array.
 *
 * ### Index rationale
 *
 * Every index below reflects a legacy-baseline single-column index that
 * an existing hot path already relies on. `content_items` gets six
 * indexes: `url_id` (via `UNIQUE` auto-index), `is_external`, `scraped`,
 * `redirect_dest_id` (for the Page Detail inbound-redirect list),
 * `content_type_id`, `crawl_order`, and `source` — all present on
 * legacy `pages`. `page_meta` gets `og_type` and `robots_noindex`
 * because both were indexed on legacy `pages` for the noindex /
 * og:type filter hot paths; after the split those readers land on
 * `page_meta` and need the indexes to remain sub-second. `resource_items` gets `url_id`
 * (via `UNIQUE` auto-index) and `source`. `anchor_edges` gets one
 * reverse-direction index (`idx_anchor_edges_href`); the UNIQUE
 * auto-index covers the forward direction. `resource_ref_edges` needs
 * an explicit reverse-direction index on `page_id` because the
 * composite PK `(resource_id, page_id)` only satisfies the `resource_id`-
 * first prefix; the legacy `resources-referrers` table had exactly
 * this reverse-direction index. `image_items` gets one index on
 * `page_id`. No summary / listfilter compound indexes are created here —
 * they belong to the viewer read model built directly against these
 * tables.
 *
 * ### Idempotency
 *
 * All statements use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT
 * EXISTS` so the primitive is safe to call multiple times against the
 * same DB. Both call sites (`initSchema` and
 * `migrateEntityTables`) still guard on their own sentinels,
 * but the function itself no longer depends on the sentinel being
 * checked first — this closes the partial-corruption gap where, say,
 * `content_items` exists but `page_meta` was dropped by an external
 * repair pass.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function createEntityTables(instance: Knex): Promise<void> {
	await instance.raw(`
		CREATE TABLE IF NOT EXISTS content_items (
			id               INTEGER PRIMARY KEY AUTOINCREMENT,
			url_id           INTEGER NOT NULL UNIQUE REFERENCES url_refs(id),
			is_external      INTEGER NOT NULL,
			scraped          INTEGER NOT NULL,
			is_target        INTEGER NOT NULL,
			status           INTEGER,
			status_text      TEXT,
			content_type_id  INTEGER REFERENCES content_type_refs(id),
			content_length   INTEGER,
			header_set_id    INTEGER REFERENCES header_sets(id),
			redirect_dest_id INTEGER REFERENCES content_items(id) DEFERRABLE INITIALLY DEFERRED,
			source           TEXT NOT NULL DEFAULT 'crawled',
			first_crawled_at INTEGER,
			last_crawled_at  INTEGER,
			crawl_order      INTEGER,
			is_skipped       INTEGER,
			skip_reason      TEXT
		)
	`);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_content_items_external ON content_items(is_external)',
	);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_content_items_scraped ON content_items(scraped)',
	);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_content_items_redirect_dest_id ON content_items(redirect_dest_id)',
	);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_content_items_content_type_id ON content_items(content_type_id)',
	);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_content_items_crawl_order ON content_items(crawl_order)',
	);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_content_items_source ON content_items(source)',
	);

	await instance.raw(`
		CREATE TABLE IF NOT EXISTS page_meta (
			page_id                     INTEGER PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
			lang                        TEXT,
			dir                         TEXT,
			charset                     TEXT,
			base_href                   TEXT,
			viewport_raw                TEXT,
			theme_color                 TEXT,
			application_name            TEXT,
			author                      TEXT,
			generator                   TEXT,
			publisher                   TEXT,
			title_text_id               INTEGER REFERENCES text_refs(id),
			description_text_id         INTEGER REFERENCES text_refs(id),
			keywords_text_id            INTEGER REFERENCES text_refs(id),
			robots_raw_text_id          INTEGER REFERENCES text_refs(id),
			robots_noindex              INTEGER,
			robots_nofollow             INTEGER,
			robots_noarchive            INTEGER,
			robots_noimageindex         INTEGER,
			googlebot                   TEXT,
			canonical_url_id            INTEGER REFERENCES url_refs(id),
			amphtml_url_id              INTEGER REFERENCES url_refs(id),
			manifest_url_id             INTEGER REFERENCES url_refs(id),
			icon_url_id                 INTEGER REFERENCES url_refs(id),
			apple_touch_icon_url_id     INTEGER REFERENCES url_refs(id),
			og_type                     TEXT,
			og_title_text_id            INTEGER REFERENCES text_refs(id),
			og_description_text_id      INTEGER REFERENCES text_refs(id),
			og_url_id                   INTEGER REFERENCES url_refs(id),
			og_image_url_id             INTEGER REFERENCES url_refs(id),
			og_site_name                TEXT,
			og_image_alt                TEXT,
			og_image_width              TEXT,
			og_image_height             TEXT,
			og_locale                   TEXT,
			og_article_published_time   TEXT,
			og_article_modified_time    TEXT,
			twitter_card                TEXT,
			twitter_site                TEXT,
			twitter_creator             TEXT,
			twitter_title_text_id       INTEGER REFERENCES text_refs(id),
			twitter_description_text_id INTEGER REFERENCES text_refs(id),
			twitter_image_url_id        INTEGER REFERENCES url_refs(id),
			fb_app_id                   TEXT,
			verification_google         TEXT,
			format_detection_telephone  INTEGER,
			tag_count                   INTEGER,
			jsonld_count                INTEGER,
			tags_providers_csv          TEXT,
			meta_extras_json_id         INTEGER REFERENCES json_refs(id),
			main_content_node_name      TEXT,
			main_content_id             TEXT,
			main_content_role           TEXT,
			main_content_selector       TEXT,
			main_content_class_list     TEXT,
			main_content_word_count     INTEGER,
			main_content_body_word_count INTEGER,
			main_content_heading_count  INTEGER,
			main_content_image_count    INTEGER,
			main_content_table_count    INTEGER,
			main_content_button_count   INTEGER,
			main_content_iframe_count   INTEGER,
			main_content_video_count    INTEGER,
			main_content_audio_count    INTEGER,
			main_content_canvas_count   INTEGER,
			scroll_height_desktop       INTEGER,
			scroll_height_mobile        INTEGER
		)
	`);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_page_meta_og_type ON page_meta(og_type)',
	);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_page_meta_robots_noindex ON page_meta(robots_noindex)',
	);

	await instance.raw(`
		CREATE TABLE IF NOT EXISTS resource_items (
			id               INTEGER PRIMARY KEY AUTOINCREMENT,
			url_id           INTEGER UNIQUE REFERENCES url_refs(id),
			url_blob_id      INTEGER UNIQUE REFERENCES blob_refs(id),
			is_external      INTEGER NOT NULL,
			status           INTEGER,
			status_text      TEXT,
			content_type_id  INTEGER REFERENCES content_type_refs(id),
			content_length   INTEGER,
			header_set_id    INTEGER REFERENCES header_sets(id),
			compress         TEXT,
			cdn              TEXT,
			source           TEXT NOT NULL DEFAULT 'crawled',
			CHECK ((url_id IS NULL) != (url_blob_id IS NULL))
		)
	`);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_resource_items_source ON resource_items(source)',
	);

	await instance.raw(`
		CREATE TABLE IF NOT EXISTS anchor_edges (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			page_id       INTEGER NOT NULL REFERENCES content_items(id),
			href_page_id  INTEGER NOT NULL REFERENCES content_items(id),
			count         INTEGER NOT NULL,
			first_hash    TEXT,
			first_text_id INTEGER REFERENCES text_refs(id),
			UNIQUE(page_id, href_page_id)
		)
	`);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_anchor_edges_href ON anchor_edges(href_page_id)',
	);

	await instance.raw(`
		CREATE TABLE IF NOT EXISTS resource_ref_edges (
			resource_id INTEGER NOT NULL REFERENCES resource_items(id),
			page_id     INTEGER NOT NULL REFERENCES content_items(id),
			count       INTEGER NOT NULL DEFAULT 1,
			PRIMARY KEY(resource_id, page_id)
		) WITHOUT ROWID
	`);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_resource_ref_edges_page ON resource_ref_edges(page_id)',
	);

	await instance.raw(`
		CREATE TABLE IF NOT EXISTS image_items (
			id                  INTEGER PRIMARY KEY AUTOINCREMENT,
			page_id             INTEGER NOT NULL REFERENCES content_items(id),
			src_url_id          INTEGER REFERENCES url_refs(id),
			current_src_url_id  INTEGER REFERENCES url_refs(id),
			src_blob_id         INTEGER REFERENCES blob_refs(id),
			current_src_blob_id INTEGER REFERENCES blob_refs(id),
			alt_text_id         INTEGER REFERENCES text_refs(id),
			width               REAL,
			height              REAL,
			natural_width       INTEGER,
			natural_height      INTEGER,
			is_lazy             INTEGER,
			viewport_width      INTEGER,
			dom_path_text_id    INTEGER NOT NULL REFERENCES text_refs(id),
			CHECK (
				(src_url_id IS NULL OR src_blob_id IS NULL)
				AND (current_src_url_id IS NULL OR current_src_blob_id IS NULL)
			)
		)
	`);
	await instance.raw(
		'CREATE INDEX IF NOT EXISTS idx_image_items_page ON image_items(page_id)',
	);
}
