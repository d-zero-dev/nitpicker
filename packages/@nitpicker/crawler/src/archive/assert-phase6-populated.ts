import type { Knex } from 'knex';

/**
 * Thrown by {@link assertPhase6Populated} when an archive predates the
 * Phase 6 write-model refactor (pre-6 `pages`/`anchors`/... rows exist but
 * the Phase 6-C entity tables are empty). Distinct from
 * `IncompatibleArchiveError` (which fires on `info.version` mismatches for
 * the 0.10 format cut) so CLI / viewer boundaries can print a Phase 6-F
 * specific migration hint.
 */
export class Phase6NotMigratedError extends Error {
	/** @param message - Human-readable explanation including the migration command. */
	constructor(message: string) {
		super(message);
		this.name = 'Phase6NotMigratedError';
	}
}

/**
 * Reads a single-cell count from a Knex `count()` result, tolerating an
 * empty row array (e.g. drivers that omit the row for aggregates on an
 * unavailable table) by returning `0`.
 * @param instance - Knex handle.
 * @param table - Table to count.
 * @returns Row count as a JS number.
 */
async function countRows(instance: Knex, table: string): Promise<number> {
	const rows = (await instance(table).count({ count: '*' })) as {
		count: number | string;
	}[];
	return Number(rows[0]?.count ?? 0);
}

/** Migration-hint message shared by the two throw sites. */
const MIGRATION_HINT =
	'This archive predates Phase 6 and has not been migrated. Run ' +
	'`node scripts/migrate-to-phase6.mjs <archive>` on the .nitpicker file ' +
	'before opening it with this CLI.';

/**
 * Rejects archives that have `pages` rows but no matching `content_items`
 * rows — the Phase 6-C entity tables have been created (by
 * `migratePhase6CEntityTables`) but never populated by
 * `scripts/migrate-to-phase6.mjs`. Phase 6-F readers rely on the new tables
 * exclusively, so opening such an archive would surface as an empty viewer
 * / MCP / CLI response instead of a clear error.
 *
 * Fresh archives (no `pages` rows yet) pass through — a writer will
 * populate both `pages` and `content_items` during crawl.
 *
 * Legacy read-only stubs (no `pages` table yet, e.g. pre-schema-init
 * `._nitpicker-*` tmpDirs) also pass through — `assertCompatibleVersion`
 * handles those cases separately upstream.
 * @param instance - The libsql / better-sqlite3-shaped Knex instance.
 * @throws {Phase6NotMigratedError} When `pages` has rows and
 *   `content_items` is empty (or the table is missing entirely).
 */
export async function assertPhase6Populated(instance: Knex): Promise<void> {
	const hasPages = await instance.schema.hasTable('pages');
	if (!hasPages) {
		return;
	}
	const pagesCount = await countRows(instance, 'pages');
	if (pagesCount === 0) {
		return;
	}
	const hasContentItems = await instance.schema.hasTable('content_items');
	if (!hasContentItems) {
		throw new Phase6NotMigratedError(MIGRATION_HINT);
	}
	const contentItemsCount = await countRows(instance, 'content_items');
	if (contentItemsCount > 0) {
		return;
	}
	throw new Phase6NotMigratedError(MIGRATION_HINT);
}
