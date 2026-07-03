import type { Knex } from 'knex';

/**
 * Drops all 7 viewer-read-model tables if present, against the given
 * connection. Shared by `buildViewerReadModel` (which drops before
 * recreating, inside its own rebuild transaction) and
 * `dropViewerReadModel` (which drops with no recreate), so the 7-table
 * list only needs to be kept in sync with `createViewerReadModelTables`
 * in one place.
 * @param trx - An open Knex transaction (a plain `Knex` instance also
 *   works, e.g. in tests).
 */
export async function dropViewerReadModelTables(trx: Knex): Promise<void> {
	await trx.schema.dropTableIfExists('viewer_directory_pages');
	await trx.schema.dropTableIfExists('viewer_directory_nodes');
	await trx.schema.dropTableIfExists('viewer_page_anchors');
	await trx.schema.dropTableIfExists('viewer_count_buckets');
	await trx.schema.dropTableIfExists('viewer_query_profiles');
	await trx.schema.dropTableIfExists('viewer_pages');
	await trx.schema.dropTableIfExists('viewer_read_model_meta');
}
