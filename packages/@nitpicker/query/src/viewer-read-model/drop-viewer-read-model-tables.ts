import type { Knex } from 'knex';

/**
 * Drops all 27 viewer-read-model tables if present, against the given
 * connection. Shared by `buildViewerReadModel` (which drops before
 * recreating, inside its own rebuild transaction) and
 * `dropViewerReadModel` (which drops with no recreate), so the table
 * list only needs to be kept in sync with `createViewerReadModelTables`
 * in one place.
 * @param trx - An open Knex transaction (a plain `Knex` instance also
 *   works, e.g. in tests).
 */
export async function dropViewerReadModelTables(trx: Knex): Promise<void> {
	await trx.schema.dropTableIfExists('viewer_technology_directory_stats');
	await trx.schema.dropTableIfExists('viewer_technology_summary');
	await trx.schema.dropTableIfExists('viewer_mismatches');
	await trx.schema.dropTableIfExists('viewer_duplicate_group_pages');
	await trx.schema.dropTableIfExists('viewer_duplicate_groups');
	await trx.schema.dropTableIfExists('viewer_header_checks');
	await trx.schema.dropTableIfExists('viewer_images');
	await trx.schema.dropTableIfExists('viewer_resource_groups');
	await trx.schema.dropTableIfExists('viewer_resource_stats');
	await trx.schema.dropTableIfExists('viewer_resources');
	await trx.schema.dropTableIfExists('viewer_graph_edges');
	await trx.schema.dropTableIfExists('viewer_graph_nodes');
	await trx.schema.dropTableIfExists('viewer_isolated_component_pages');
	await trx.schema.dropTableIfExists('viewer_isolated_components');
	await trx.schema.dropTableIfExists('viewer_error_kind_meta');
	await trx.schema.dropTableIfExists('viewer_error_kind_entries');
	await trx.schema.dropTableIfExists('viewer_anchor_facts');
	await trx.schema.dropTableIfExists('viewer_external_links');
	await trx.schema.dropTableIfExists('viewer_url_refs');
	await trx.schema.dropTableIfExists('viewer_directory_pages');
	await trx.schema.dropTableIfExists('viewer_directory_nodes');
	await trx.schema.dropTableIfExists('viewer_page_anchors');
	await trx.schema.dropTableIfExists('viewer_count_buckets');
	await trx.schema.dropTableIfExists('viewer_query_profiles');
	await trx.schema.dropTableIfExists('viewer_pages');
	await trx.schema.dropTableIfExists('viewer_summary');
	await trx.schema.dropTableIfExists('viewer_read_model_meta');
}
