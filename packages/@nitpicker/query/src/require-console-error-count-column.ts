import type { Knex } from 'knex';

/**
 * Throws an actionable error when `page_meta.console_error_count` does not
 * exist on this connection, instead of letting every page-list query that
 * selects it (via `PAGE_LIST_SELECT_COLUMNS`) fail with a raw
 * `no such column` SQL error.
 *
 * `console_error_count`'s column-add migration
 * (`migratePageMetaConsoleErrorCount`) only runs on a writable open
 * (`Archive.create`/`Archive.open`) — read-only connections (`query` CLI,
 * viewer, MCP) never self-heal a legacy archive's schema (see
 * `db-ops/lifecycle/init.ts`). An archive that predates this feature and has
 * never since been opened for writing (`crawl`, `crawl --append` /
 * `--retry-failed`, `viewer-build`) genuinely lacks the column on a
 * read-only connection — the same shape `requireAliasOfIdColumn` and
 * `findDuplicateBodies`'s `body_hash` check already guard against.
 * @param knex - The Knex query builder instance connected to the database.
 * @throws {Error} If `page_meta.console_error_count` does not exist.
 * @example
 * await requireConsoleErrorCountColumn(knex); // throws with a viewer-build hint if missing
 */
export async function requireConsoleErrorCountColumn(knex: Knex): Promise<void> {
	if (!(await knex.schema.hasColumn('page_meta', 'console_error_count'))) {
		throw new Error(
			'This archive predates the page_meta.console_error_count column. ' +
				'Run `viewer-build` (or a writable crawl: `crawl --append` / `--retry-failed`) ' +
				'against it once to add console_error_count first.',
		);
	}
}
