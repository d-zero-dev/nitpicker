import type { Knex } from 'knex';

/**
 * Throws an actionable error when `content_items.alias_of_id` does not
 * exist on this connection, instead of letting every query that references
 * the column fail with a raw `no such column` SQL error.
 *
 * `alias_of_id`'s column-add migration
 * (`migrateContentItemsAliasOfId`) only runs on a writable open
 * (`Archive.create`/`Archive.open`) — read-only connections (`query` CLI,
 * viewer, MCP) never self-heal a legacy archive's schema (see
 * `db-ops/lifecycle/init.ts`). An archive that predates this feature and has
 * never since been opened for writing (`crawl`, `crawl --append` /
 * `--retry-failed`, `viewer-build`) genuinely lacks the column on a
 * read-only connection.
 *
 * Every query function that reads `alias_of_id` calls this once, at the top,
 * before building its query — the same pattern `find-duplicate-bodies.ts`
 * established for `page_meta.body_hash`, applied uniformly here rather than
 * having each call site branch between an alias-aware and an alias-unaware
 * query shape.
 * @param knex - The Knex query builder instance connected to the database.
 * @throws {Error} If `content_items.alias_of_id` does not exist.
 */
export async function requireAliasOfIdColumn(knex: Knex): Promise<void> {
	if (!(await knex.schema.hasColumn('content_items', 'alias_of_id'))) {
		throw new Error(
			'This archive predates the content_items.alias_of_id column. ' +
				'Run `viewer-build` (or a writable crawl: `crawl --append` / `--retry-failed`) ' +
				'against it once to add and compute alias_of_id first.',
		);
	}
}
