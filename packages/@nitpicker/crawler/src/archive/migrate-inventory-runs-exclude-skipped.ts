import type { Knex } from 'knex';

/**
 * Adds the `inventory_runs.exclude_skipped` column to archives created
 * before it existed. `CREATE TABLE IF NOT EXISTS` (used for `inventory_runs`
 * itself) cannot retrofit a new column onto an already-existing table, so
 * this lightweight, `hasColumn`-guarded `ALTER TABLE` runs on every
 * `initSchema` call — idempotent, and self-healing for archives whose
 * provisioning crashed partway through.
 *
 * Pre-migration rows stay `NULL`: those runs predate ingestion-side
 * exclusion (issue #260), so their excluded URLs were imported as real
 * pages/resources rather than recorded as skipped — `NULL` means "not
 * measured", not `0`.
 *
 * The column is pure audit output: written once per run and read back
 * only by `listInventoryRuns` display surfaces, never consumed by any
 * runtime decision — matching `scope_skipped` / `invalid_skipped`.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateInventoryRunsExcludeSkipped(instance: Knex): Promise<void> {
	const hasTable = await instance.schema.hasTable('inventory_runs');
	if (!hasTable) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn('inventory_runs', 'exclude_skipped');
	if (hasColumn) {
		return;
	}
	await instance.schema.table('inventory_runs', (t) => {
		t.integer('exclude_skipped');
	});
	// eslint-disable-next-line no-console
	console.error('[migrate] inventory_runs.exclude_skipped column added');
}
