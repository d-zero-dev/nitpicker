import type { Knex } from 'knex';

/**
 * Whether both `console_log_items` and `page_console_logs` exist on this
 * connection (issue #228) — the single source of truth every console-logs
 * query function guards on before querying, instead of each hand-checking
 * a different one of the two tables.
 *
 * Both tables are always read together (every query JOINs across them), so
 * checking only one would let a connection whose `createAdjunctTables` was
 * interrupted between the two tables' independent per-table guards (see
 * that function's docs) pass one function's check and throw `no such
 * table` inside another's JOIN.
 *
 * Archives that predate this feature, and read-only `stub` connections
 * (`Archive.connect({ readOnly: true })` skips migrations), both arrive
 * with neither table — the common case this guards against.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns `true` only when both tables exist.
 * @example
 * if (!(await hasConsoleLogsTables(knex))) {
 *   return { items: [], total: 0 };
 * }
 */
export async function hasConsoleLogsTables(knex: Knex): Promise<boolean> {
	const [hasItems, hasEdges] = await Promise.all([
		knex.schema.hasTable('console_log_items'),
		knex.schema.hasTable('page_console_logs'),
	]);
	return hasItems && hasEdges;
}
