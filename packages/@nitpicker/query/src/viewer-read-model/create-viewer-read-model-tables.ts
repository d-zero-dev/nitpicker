import type { Knex } from 'knex';

/**
 * Creates all 23 viewer-read-model tables against the given connection, with
 * no indexes. Assumes none of the tables currently exist — callers
 * (`buildViewerReadModel`) are responsible for dropping any prior version
 * first, inside the same transaction, so this function is not itself
 * idempotent.
 *
 * Indexes are deliberately NOT created here — see
 * `createViewerReadModelIndexes`'s docs for why building them after each
 * table's bulk load, rather than up front, is a large, measured win at real
 * archive scale.
 *
 * Every statement runs via `raw()` rather than knex's chainable schema
 * builder: 8 of the 11 non-`viewer_summary` tables need `WITHOUT ROWID` / a
 * composite primary key / a `CHECK` constraint / a table-level `UNIQUE`
 * constraint, none of which the chainable builder can express (the same
 * reason `page_html_blobs` / `page_html_ref` drop to `raw()` in
 * `@nitpicker/crawler`'s `init-schema.ts`). Using `raw()` for every table
 * keeps this function a single uniform style instead of mixing two
 * schema-definition APIs.
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests that don't need transactional rollback).
 */
export async function createViewerReadModelTables(trx: Knex): Promise<void> {
	await trx.raw(`
		CREATE TABLE viewer_read_model_meta (
			id integer primary key check (id = 1),
			schema_version integer not null,
			built_at integer not null,
			source_row_count integer not null
		)
	`);

	// Single-row site-wide summary statistics, mirroring `SummaryResult`
	// minus `baseUrl`/`roots` (those come from `accessor.getConfig()`,
	// independent of `pages` aggregation — see `getViewerSummary`'s docs).
	// JSON columns store `JSON.stringify`d arrays/objects verbatim; no
	// `url_refs`/`content_items` ref-table indirection, matching this
	// codebase's `pages`-direct convention rather than
	// `docs/viewer-sql-query-plan.md`'s aspirational design — same
	// rationale as `viewer_anchor_facts` below. `/api/error-kinds`'
	// `viewer_error_kind_*` tables are a separate endpoint/issue; the
	// `status=-1` error-kind breakdown here stays embedded inside
	// `status_json` instead.
	await trx.raw(`
		CREATE TABLE viewer_summary (
			id integer primary key check (id = 1),
			total_pages integer not null,
			internal_pages integer not null,
			external_pages integer not null,
			internal_contents integer not null,
			external_contents integer not null,
			status_json text not null,
			content_type_json text not null,
			metadata_json text not null
		)
	`);

	await trx.raw(`
		CREATE TABLE viewer_pages (
			page_id integer primary key,
			url text not null,
			title text,
			status integer,
			status_sort_key integer not null,
			status_desc_key integer not null,
			content_category text not null,
			is_external integer not null,
			has_title integer not null,
			has_description integer not null,
			has_og_title integer not null,
			robots_noindex integer not null,
			source text not null,
			tag_count integer not null default 0,
			jsonld_count integer not null default 0,
			url_sort_key text not null,
			title_sort_key text not null,
			path_sort_key text not null
		)
	`);

	await trx.raw(`
		CREATE TABLE viewer_query_profiles (
			scope text not null,
			profile_key text not null,
			sort_key text not null,
			sort_order text not null,
			total integer not null,
			primary key(scope, profile_key)
		) WITHOUT ROWID
	`);

	await trx.raw(`
		CREATE TABLE viewer_count_buckets (
			scope text not null,
			key text not null,
			value text not null,
			count integer not null,
			primary key(scope, key, value)
		) WITHOUT ROWID
	`);

	await trx.raw(`
		CREATE TABLE viewer_page_anchors (
			scope text not null,
			profile_key text not null,
			page_size integer not null,
			page_index integer not null,
			anchor_text_key text,
			anchor_number_key integer,
			anchor_id integer not null,
			row_offset integer not null,
			primary key(scope, profile_key, page_size, page_index)
		) WITHOUT ROWID
	`);

	await trx.raw(`
		CREATE TABLE viewer_directory_nodes (
			node_id integer primary key,
			parent_node_id integer,
			root_key text not null,
			depth integer not null,
			name text not null,
			path text not null,
			name_sort_key text not null,
			path_sort_key text not null,
			direct_child_dir_count integer not null,
			direct_page_count integer not null,
			descendant_page_count integer not null,
			internal_descendant_page_count integer not null,
			external_descendant_page_count integer not null,
			has_children integer not null,
			unique(root_key, path)
		)
	`);

	await trx.raw(`
		CREATE TABLE viewer_directory_pages (
			node_id integer not null,
			page_id integer not null,
			page_url_sort_key text not null,
			primary key(node_id, page_id)
		) WITHOUT ROWID
	`);

	// Pre-aggregated, deduplicated-by-canonical-destination external link
	// summary — derived in memory from `viewer_anchor_facts` rows (see
	// `deriveExternalLinkSummaryRows`'s docs) rather than its own `anchors`
	// scan, so building this table costs no extra JOIN over the one
	// `computeAnchorFactRows` already does. See ARCHITECTURE.md「設計注意
	// （viewer_anchor_facts read model、issue #114）」for the SQLite
	// COUNT(DISTINCT)/GROUP BY performance rationale this sidesteps.
	await trx.raw(`
		CREATE TABLE viewer_external_links (
			dest_page_id integer primary key,
			dest_url text not null,
			status integer,
			referrer_count integer not null
		)
	`);

	// Edge-level (one row per unique (source_page_id, dest_page_id) pair,
	// with `count` absorbing duplicate anchor observations between the same
	// pair) fact table backing broken-link listing. Deliberately has no
	// `url_refs`/`content_items` ref-table indirection (issue #139 — not
	// landed, and #103's own execution order places it after this table):
	// `source_url_sort_key`/`dest_url_sort_key` are inline text, copied at
	// build time exactly like `viewer_pages.url_sort_key`, so indexed
	// `ORDER BY` works without a pre-join. Full URL text for the OTHER
	// (non-sort-key) display columns is resolved by joining back to `pages`
	// only after the id set is limit-bounded (same limit-before-join
	// pattern as `joinViewerPageIdsToListItems`). `is_external_link` is
	// stored (SQLite INTEGER 0/1 costs ~0 bytes) but intentionally has no
	// index: nothing reads this table filtered by it — it exists only for
	// `deriveExternalLinkSummaryRows`'s in-memory pass over the full row
	// set at build time. `status_desc_key` mirrors `viewer_pages`'s same
	// column for the same reason: `docs/viewer-sql-query-plan.md`'s Stable
	// Ordering rule keeps the `source_url_sort_key`/`edge_id` tie-breakers
	// ascending even when the primary sort is `status desc` — a row-value
	// keyset tuple comparison can't mix per-column directions, so the
	// primary column is negated and walked ascending instead. See
	// ARCHITECTURE.md「設計注意（viewer_anchor_facts read model、issue
	// #114）」for the full read/write/storage rationale.
	await trx.raw(`
		CREATE TABLE viewer_anchor_facts (
			edge_id integer primary key,
			source_page_id integer not null,
			dest_page_id integer not null,
			source_url_sort_key text not null,
			dest_url_sort_key text not null,
			status integer,
			status_sort_key integer not null,
			status_desc_key integer not null,
			count integer not null,
			is_broken integer not null,
			is_external_link integer not null
		)
	`);

	// Precomputed `/api/error-kinds` breakdown (issue #118, reshaped after a
	// `dev`-side breaking change normalized `getErrorKinds` to one row per
	// host×kind pair — see this table's docs for why the original
	// groups/hosts/samples split was replaced by a single entries table).
	// Populated from `computeErrorKindInsertRows`'s normalisation of an
	// already-classified `getErrorKinds` result — `classifyErrorKind` itself
	// runs exactly once, inside `getErrorKinds`, never a second time here
	// (this codebase's "don't duplicate classification logic" rule).
	//
	// One row per unique (host, kind) pair — the same grain `getErrorKinds`
	// itself aggregates to. `sample_urls_json` is a `JSON.stringify`d array
	// (matching `viewer_summary`'s JSON-column convention) rather than a
	// separate samples table: samples are always read together with their
	// owning row, never filtered/sorted independently, so there is no query
	// shape that benefits from normalising them out. Deliberately has no
	// `url_refs` FK for the same reason `viewer_anchor_facts`/`viewer_summary`
	// don't (issue #139's ref-tables are not implemented).
	await trx.raw(`
		CREATE TABLE viewer_error_kind_entries (
			host text not null,
			kind text not null,
			count integer not null,
			sample_urls_json text not null,
			overflowed_count integer not null,
			primary key(host, kind)
		) WITHOUT ROWID
	`);

	// Single-row archive-wide totals (`ErrorKindsResult.facets`), unaffected
	// by `host`/`kind` filters — the same single-row convention as
	// `viewer_summary`, kept as its own table rather than extra columns on
	// `viewer_read_model_meta` because these two values are specific to the
	// error-kind breakdown, not the read model as a whole.
	await trx.raw(`
		CREATE TABLE viewer_error_kind_meta (
			id integer primary key check (id = 1),
			total_records integer not null,
			channel_source text not null
		)
	`);

	await trx.raw(`
		CREATE TABLE viewer_isolated_components (
			component_id integer primary key,
			representative_url text not null,
			representative_title text,
			representative_status integer,
			representative_url_sort_key text not null,
			representative_title_sort_key text not null,
			representative_status_sort_key integer not null,
			representative_status_desc_key integer not null,
			size integer not null,
			size_desc_key integer not null,
			unique(representative_url)
		)
	`);

	await trx.raw(`
		CREATE TABLE viewer_isolated_component_pages (
			component_id integer not null,
			page_id integer not null,
			url text not null,
			title text,
			status integer,
			source text not null,
			url_sort_key text not null,
			title_sort_key text not null,
			status_sort_key integer not null,
			status_desc_key integer not null,
			primary key(component_id, page_id)
		) WITHOUT ROWID
	`);

	await trx.raw(`
		CREATE TABLE viewer_graph_nodes (
			page_id integer primary key,
			url text not null,
			status integer,
			indegree integer not null
		)
	`);

	await trx.raw(`
		CREATE TABLE viewer_graph_edges (
			source_page_id integer not null,
			target_page_id integer not null,
			primary key(source_page_id, target_page_id)
		) WITHOUT ROWID
	`);

	// Resource-list read model (issue #110). `status_sort_key`/`status_desc_key`
	// reuse `viewer_pages`/`viewer_anchor_facts`'s `NULL_STATUS_SENTINEL`
	// convention, and `url_sort_key` is the URL copied verbatim — same
	// rationale as `viewer_pages.url_sort_key` (kept as its own column so a
	// future normalisation change doesn't require renaming the index). No
	// `content_category` column (unlike `viewer_pages`): neither
	// `ListViewerResourcesOptions` nor `ListViewerUnusedResourcesOptions`
	// filters on it — `ListResourcesOptions.contentType` is a raw MIME prefix
	// the read model doesn't classify, and bails to legacy regardless (see
	// `register-resources-route.ts`). `is_unused` is duplicated onto this
	// table (rather than living only in `viewer_resource_stats`) because
	// `/api/unused-resources` needs it as a pre-limit filter column, exactly
	// like `viewer_anchor_facts.is_broken`.
	await trx.raw(`
		CREATE TABLE viewer_resources (
			resource_id integer primary key,
			is_external integer not null,
			status integer,
			status_sort_key integer not null,
			status_desc_key integer not null,
			source text not null,
			is_unused integer not null,
			url_sort_key text not null
		)
	`);

	// Split from `viewer_resources` (rather than a `referrer_count` column on
	// it) to match issue #110's TO-BE table naming verbatim. No dedicated
	// index: it is only ever joined by `resource_id` after `viewer_resources`
	// has already limited the id set (see `joinViewerResourceIdsToListItems`),
	// and no fast path currently sorts by `referrer_count` (see the comment
	// above `viewer_resources`).
	await trx.raw(`
		CREATE TABLE viewer_resource_stats (
			resource_id integer primary key,
			referrer_count integer not null
		)
	`);

	// Image-list read model (issue #113). Deliberately a single table (no
	// `viewer_image_stats`-style split like `viewer_resources` — that split
	// only existed to match issue #110's own table naming verbatim, and
	// issue #113's text names just one table). Excludes `src`/`currentSrc`/
	// `alt`/`sourceCode`: those large text columns are resolved by joining
	// back to `images`/`pages` only after the id set is limit-bounded (see
	// `joinViewerImageIdsToListItems`), never duplicated here — the same
	// "join only after limiting" rule every other table follows, but
	// stricter here because `images` is this codebase's single largest
	// write-model table (~9.11M rows / 3.25GB on a real archive).
	// `page_url_rank` — NOT `page_url_sort_key` text like `viewer_pages`/
	// `viewer_resources`/`viewer_anchor_facts`/`viewer_directory_pages` all
	// use — is `viewer_images`'s one deliberate deviation from this read
	// model's usual "inline the sort key as text" convention:
	// `docs/viewer-db-redesign-plan.md` explicitly warns against duplicating
	// `page_url` into this table by name, citing its ~9.11M-row scale as
	// uniquely dangerous (every other table inlining a text sort key sits at
	// a much smaller one-row-per-page/resource/edge cardinality). See
	// `buildPageUrlRankMap`'s docs for the full rationale.
	// `natural_width`/`natural_height` are stored as raw values (not a
	// precomputed boolean flag at one hard-coded threshold, unlike
	// `docs/viewer-sql-query-plan.md`'s `oversized_1000` sketch) because
	// `listImages`'s `oversizedThreshold` accepts an arbitrary caller-supplied
	// pixel count — see `applyViewerImagesFilters`'s docs.
	// No `page_id` column: it exists only transiently while computing
	// `page_url_rank` at build time (`computeImageInsertRows` looks it up
	// from the source `images` row, never from this table), and no query
	// here ever needs to join back to `pages` by page — display joins go
	// through `image_id` → `images.pageId` → `pages` in
	// `joinViewerImageIdsToListItems` instead. Storing an unread integer
	// column across ~9.11M rows would itself be exactly the kind of
	// unnecessary duplication this table's other design choices go out of
	// their way to avoid.
	await trx.raw(`
		CREATE TABLE viewer_images (
			image_id integer primary key,
			page_url_rank integer not null,
			missing_alt integer not null,
			missing_dimensions integer not null,
			width real not null,
			height real not null,
			natural_width integer not null,
			natural_height integer not null,
			is_lazy integer not null
		)
	`);

	// Header-check read model (issue #119). One row per internal HTML page —
	// the exact `scraped = 1, isExternal = 0, contentType = 'text/html',
	// redirectDestId IS NULL` predicate `checkHeaders` itself filters to, NOT
	// `viewer_pages`'s broader unfiltered set — so this table's row count can
	// legitimately be smaller than `viewer_pages`'s. `has_csp`/
	// `has_x_frame_options`/`has_x_content_type_options`/`has_hsts` are
	// precomputed booleans (never a raw `responseHeaders` JSON blob column):
	// `computeHeaderCheckInsertRows` derives them at build time via the same
	// `headerPresenceExpression` LIKE-based SQL `checkHeaders`/`listPages`
	// already use, so no JSON parsing happens here or at read time either.
	// `url_sort_key` is `url` copied verbatim — the same "inline the sort key
	// as text" convention `viewer_resources`/`viewer_anchor_facts` use for
	// their own one-row-per-entity tables, and cheap here for the same reason
	// (bounded by page count, not a fan-out table like `viewer_images`).
	// Unlike every other read-model table, no `url_refs`/`content_items`
	// ref-table indirection exists to reconstruct full header entries from
	// (issue #139 is not implemented) — detail/export views instead read the
	// write-model `pages.responseHeaders` blob directly by `page_id`, which
	// is unaffected by this table's existence. `missing_count` is a
	// precomputed 0-4 tally, kept for display/detail use, but is NOT what
	// `missingOnly` filters on — a range predicate (`missing_count > 0`) on
	// an index's leading column cannot also satisfy `ORDER BY url_sort_key`
	// (SQLite would need to visit each `missing_count` bucket's url-sorted
	// run in turn, which is not a single globally url-sorted scan), so a
	// dedicated boolean `is_missing` column (`missing_count > 0`, mirroring
	// `viewer_pages.has_title`'s boolean-flag-not-count convention) backs the
	// `missingOnly` filter instead — an equality predicate on the leading
	// index column DOES leave the remaining rows for that value ordered by
	// the next column, verified via `EXPLAIN QUERY PLAN` during development.
	await trx.raw(`
		CREATE TABLE viewer_header_checks (
			page_id integer primary key,
			url_sort_key text not null,
			has_csp integer not null,
			has_x_frame_options integer not null,
			has_x_content_type_options integer not null,
			has_hsts integer not null,
			missing_count integer not null,
			is_missing integer not null
		)
	`);

	// Duplicate-metadata group read model (issue #115), split into a
	// group-level table and a member-page table — the same "one narrow table
	// per grain" split `viewer_resources`/`viewer_resource_stats` and
	// `viewer_directory_nodes`/`viewer_directory_pages` already use.
	// `docs/viewer-db-redesign-plan.md`'s sketch SQL for `/api/duplicates`
	// orders by a `count_desc_key`-shaped column and filters `viewer_mismatches`
	// by a `url_sort_key`-shaped column, yet the plan's own CREATE TABLE
	// examples never define either column — this implementation resolves
	// that mismatch by following two conventions this read model already
	// established elsewhere rather than inventing a third: `count_desc_key`
	// is the negation of `count`, the same "sign-flipped integer for
	// descending keyset order" idiom as `viewer_anchor_facts.status_desc_key`/
	// `viewer_pages.status_desc_key`, and `url_sort_key` (on both new tables)
	// is `pages.url` copied verbatim, the same "inline the sort key as text"
	// convention `viewer_pages`/`viewer_anchor_facts`/`viewer_resources`/
	// `viewer_header_checks` all use so indexed `ORDER BY`/keyset comparisons
	// never need a pre-join back to `pages`.
	//
	// Like `viewer_anchor_facts`/`viewer_header_checks`, there is no
	// `url_refs`/`content_items` ref-table indirection (issue #139 is not
	// implemented, and landing it is out of scope for #115 specifically, same
	// as #119's own note) — every value is inlined directly.
	//
	// `group_id` is assigned sequentially by `computeDuplicateGroupRows`
	// itself at build time (JS-side, across both `title` and `description`
	// groups), not left to SQLite's own `AUTOINCREMENT` — the same
	// `viewer_directory_nodes.node_id` rationale: `viewer_duplicate_group_pages`
	// rows reference a group's `group_id` before either table is inserted, so
	// the id must already be known when both insert-row arrays are built.
	// `viewer_mismatches.mismatch_id`, by contrast, is left to SQLite's own
	// `AUTOINCREMENT` (like `viewer_anchor_facts.edge_id`) — nothing else in
	// this read model needs to reference a mismatch row by id before it is
	// inserted.
	//
	// `viewer_duplicate_group_pages` holds the COMPLETE member-page list for
	// a group, addressable by `/api/duplicates/:groupId/pages` — the
	// `/api/duplicates` group-listing endpoint itself reads only the first
	// few member rows per group from this same table and inlines them onto
	// the group entry, rather than joining/embedding every member inline for
	// every group at list time (mirroring `viewer_directory_pages`'s own
	// "list the parent node cheaply, list its full member-page set via a
	// separate paginated endpoint" split).
	await trx.raw(`
		CREATE TABLE viewer_duplicate_groups (
			group_id integer primary key,
			field text not null,
			value text not null,
			count integer not null,
			count_desc_key integer not null
		)
	`);

	await trx.raw(`
		CREATE TABLE viewer_duplicate_group_pages (
			group_id integer not null,
			page_id integer not null,
			url_sort_key text not null,
			primary key(group_id, page_id)
		) WITHOUT ROWID
	`);

	// Metadata-mismatch read model (issue #115): one row per page failing one
	// of `findMismatches`'s three comparisons (`canonical != url`,
	// `og_title != title`, `og_description != description`), produced by
	// `computeMismatchInsertRows`. `actual`/`expected` are nullable — a
	// mismatch by definition means both sides are non-null/non-empty at
	// build time (`findMismatches`'s own `whereNotNull`/`whereNot('', ...)`
	// guards on both compared columns), but the columns themselves stay
	// nullable rather than `not null` so this table's shape doesn't silently
	// assume that invariant can never change.
	await trx.raw(`
		CREATE TABLE viewer_mismatches (
			mismatch_id integer primary key,
			type text not null,
			page_id integer not null,
			url_sort_key text not null,
			actual text,
			expected text
		)
	`);
}
