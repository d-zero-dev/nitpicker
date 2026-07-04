import type { Knex } from 'knex';

/**
 * Creates all 12 viewer-read-model tables (and `viewer_pages`'s named
 * indexes) against the given connection. Assumes none of the tables
 * currently exist — callers (`buildViewerReadModel`) are responsible for
 * dropping any prior version first, inside the same transaction, so this
 * function is not itself idempotent.
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
	await trx.raw(
		'CREATE INDEX vp_default ON viewer_pages(is_external, content_category, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_status ON viewer_pages(is_external, content_category, status_sort_key, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_status_desc ON viewer_pages(is_external, content_category, status_desc_key, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_title ON viewer_pages(is_external, content_category, title_sort_key, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_missing_title ON viewer_pages(is_external, content_category, has_title, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_missing_description ON viewer_pages(is_external, content_category, has_description, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_noindex ON viewer_pages(is_external, content_category, robots_noindex, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_source ON viewer_pages(is_external, content_category, source, url_sort_key, page_id)',
	);

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
	// `getDirectoryTree` filters `depth <= 3` (a range, not an equality) and
	// orders by `path_sort_key` alone (grouping into per-root_key buckets
	// happens in JS afterward — see that function's docs). Leading the index
	// with `path_sort_key` lets SQLite satisfy the `ORDER BY` via a plain
	// ascending index scan with `depth` checked as a cheap residual filter,
	// instead of falling back to `USE TEMP B-TREE FOR ORDER BY`. Leading with
	// `root_key`/`depth` instead (as `docs/viewer-sql-query-plan.md`'s
	// aspirational single-root-per-request index does) would not help here:
	// a range condition on a non-leading column can't be used to avoid a sort
	// on a column that comes after it — the same index-column-order pitfall
	// `idx_pages_listfilter` hit (see ARCHITECTURE.md).
	await trx.raw(
		'CREATE INDEX vdn_path_depth ON viewer_directory_nodes(path_sort_key, depth, node_id)',
	);
	await trx.raw(
		'CREATE INDEX vdn_parent_name ON viewer_directory_nodes(parent_node_id, name_sort_key, node_id)',
	);

	await trx.raw(`
		CREATE TABLE viewer_directory_pages (
			node_id integer not null,
			page_id integer not null,
			page_url_sort_key text not null,
			primary key(node_id, page_id)
		) WITHOUT ROWID
	`);
	await trx.raw(
		'CREATE INDEX vdp_node_url ON viewer_directory_pages(node_id, page_url_sort_key, page_id)',
	);

	// Pre-aggregated, deduplicated-by-canonical-destination external link
	// summary — derived in memory from `viewer_anchor_facts` rows (see
	// `deriveExternalLinkSummaryRows`'s docs) rather than its own `anchors`
	// scan, so building this table costs no extra JOIN over the one
	// `computeAnchorFactRows` already does. See ARCHITECTURE.md「設計注意
	// （viewer_anchor_facts read model、issue #114）」for the SQLite
	// COUNT(DISTINCT)/GROUP BY performance rationale this sidesteps. No
	// `_desc_key` columns like `viewer_pages` needs: pagination here is
	// plain offset-based (via
	// `paginateQuery`), not keyset-cursor, so a single ascending index
	// scanned backward is enough for DESC.
	await trx.raw(`
		CREATE TABLE viewer_external_links (
			dest_page_id integer primary key,
			dest_url text not null,
			status integer,
			referrer_count integer not null
		)
	`);
	await trx.raw('CREATE INDEX vel_url ON viewer_external_links(dest_url, dest_page_id)');
	await trx.raw(
		'CREATE INDEX vel_status ON viewer_external_links(status, dest_url, dest_page_id)',
	);
	await trx.raw(
		'CREATE INDEX vel_referrer_count ON viewer_external_links(referrer_count, dest_url, dest_page_id)',
	);

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
	await trx.raw(
		'CREATE INDEX vaf_broken_source ON viewer_anchor_facts(is_broken, source_url_sort_key, edge_id)',
	);
	await trx.raw(
		'CREATE INDEX vaf_broken_dest ON viewer_anchor_facts(is_broken, dest_url_sort_key, edge_id)',
	);
	await trx.raw(
		'CREATE INDEX vaf_broken_status ON viewer_anchor_facts(is_broken, status_sort_key, source_url_sort_key, edge_id)',
	);
	await trx.raw(
		'CREATE INDEX vaf_broken_status_desc ON viewer_anchor_facts(is_broken, status_desc_key, source_url_sort_key, edge_id)',
	);
	await trx.raw(
		'CREATE INDEX vaf_source ON viewer_anchor_facts(source_page_id, edge_id)',
	);
	await trx.raw('CREATE INDEX vaf_dest ON viewer_anchor_facts(dest_page_id, edge_id)');

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
	//
	// Indexing is intentionally minimal: unlike `viewer_pages`/
	// `viewer_anchor_facts` (hundreds of thousands of rows), this table's
	// cardinality is bounded by distinct(host)×distinct(kind) — realistically
	// at most a few thousand rows even on a huge archive — so a full-table
	// scan+sort for the `host`/`kind` text sorts is already sub-millisecond
	// in SQLite. Only `count` (the default sort, most-failures-first) gets a
	// dedicated index; add more if a real benchmark ever shows otherwise
	// (see issue #106's evidence-before-indexing precedent). No separate
	// `host_sort_key`/`kind_sort_key` columns either (unlike
	// `viewer_pages.url_sort_key`): those exist elsewhere to isolate a future
	// case-folding/normalisation change from the base column, but `host`/
	// `kind` are never transformed anywhere in this codebase, so `ORDER BY
	// host`/`ORDER BY kind` directly is exactly as correct and needs no
	// extra columns to stay that way.
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
	await trx.raw('CREATE INDEX vee_count ON viewer_error_kind_entries(count)');

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
}
