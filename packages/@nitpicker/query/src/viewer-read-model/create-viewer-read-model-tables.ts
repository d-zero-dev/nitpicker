import type { Knex } from 'knex';

/**
 * Creates all 5 viewer-read-model tables (and `viewer_pages`'s named
 * indexes) against the given connection. Assumes none of the tables
 * currently exist — callers (`buildViewerReadModel`) are responsible for
 * dropping any prior version first, inside the same transaction, so this
 * function is not itself idempotent.
 *
 * Every statement runs via `raw()` rather than knex's chainable schema
 * builder: 4 of the 5 tables need `WITHOUT ROWID` / a composite primary key
 * / a `CHECK` constraint, none of which the chainable builder can express
 * (the same reason `page_html_blobs` / `page_html_ref` drop to `raw()` in
 * `@nitpicker/crawler`'s `init-schema.ts`). Using `raw()` for the 5th table
 * (`viewer_pages`) too keeps this function a single uniform style instead
 * of mixing two schema-definition APIs.
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
			content_category text not null,
			is_external integer not null,
			has_title integer not null,
			has_description integer not null,
			has_og_title integer not null,
			robots_noindex integer not null,
			tag_count integer not null default 0,
			jsonld_count integer not null default 0,
			url_sort_key text not null,
			title_sort_key text,
			path_sort_key text not null
		)
	`);
	await trx.raw(
		'CREATE INDEX vp_default ON viewer_pages(is_external, content_category, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_status ON viewer_pages(is_external, content_category, status, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_title ON viewer_pages(is_external, content_category, title_sort_key, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_missing_title ON viewer_pages(is_external, content_category, has_title, url_sort_key, page_id)',
	);
	await trx.raw(
		'CREATE INDEX vp_noindex ON viewer_pages(is_external, content_category, robots_noindex, url_sort_key, page_id)',
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
}
