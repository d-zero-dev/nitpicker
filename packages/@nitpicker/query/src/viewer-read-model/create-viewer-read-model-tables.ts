import type { Knex } from 'knex';

/**
 * Creates all 8 viewer-read-model tables (and `viewer_pages`'s named
 * indexes) against the given connection. Assumes none of the tables
 * currently exist — callers (`buildViewerReadModel`) are responsible for
 * dropping any prior version first, inside the same transaction, so this
 * function is not itself idempotent.
 *
 * Every statement runs via `raw()` rather than knex's chainable schema
 * builder: 5 of the 8 tables need `WITHOUT ROWID` / a composite primary key
 * / a `CHECK` constraint / a table-level `UNIQUE` constraint, none of which
 * the chainable builder can express (the same reason `page_html_blobs` /
 * `page_html_ref` drop to `raw()` in `@nitpicker/crawler`'s
 * `init-schema.ts`). Using `raw()` for every table keeps this function a
 * single uniform style instead of mixing two schema-definition APIs.
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
	// list — see `computeExternalLinkRows`'s docs for why this needs its own
	// `anchors` query rather than reusing `viewer_pages`'s `sourceRows` (the
	// aggregation joins `anchors` at build time instead of on every read,
	// see ARCHITECTURE.md「設計注意（外部リンク read model）」for the
	// SQLite COUNT(DISTINCT)/GROUP BY performance rationale). No
	// `_desc_key` columns like `viewer_pages` needs: pagination here is
	// plain offset-based (via `paginateQuery`), not keyset-cursor, so a
	// single ascending index scanned backward is enough for DESC.
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
}
