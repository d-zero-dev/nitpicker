import type { Knex } from 'knex';

/**
 * Adds the `list_reconcile_runs.exclude_skipped` column to archives created
 * before it existed. `CREATE TABLE IF NOT EXISTS` (used for
 * `list_reconcile_runs` itself) cannot retrofit a new column onto an
 * already-existing table, so this lightweight, `hasColumn`-guarded
 * `ALTER TABLE` runs on every `initSchema` call — idempotent, and
 * self-healing for archives whose provisioning crashed partway through.
 *
 * Pre-migration rows stay `NULL`: those runs predate ingestion-side
 * exclusion (issue #260), so their excluded URLs were imported as real
 * pages/resources rather than recorded as skipped — `NULL` means "not
 * measured", not `0`.
 *
 * The column is pure audit output: written once per run and read back
 * only by `listReconcileRuns` display surfaces, never consumed by any
 * runtime decision — matching `scope_skipped` / `invalid_skipped`.
 * @param instance - The Knex query builder instance connected to the database.
 * @param onLog - Called instead of `console.error` when this migration
 *   actually applies (issue #294: a bare `console.error` here can fire
 *   while a `@d-zero/dealer` `Lanes`/`TaskList` display is mid-redraw during
 *   `Archive.open`, corrupting its cursor tracking). Falls back to
 *   `console.error` when omitted (direct/test callers).
 */
export async function migrateListReconcileRunsExcludeSkipped(
	instance: Knex,
	onLog?: (message: string) => void,
): Promise<void> {
	const hasTable = await instance.schema.hasTable('list_reconcile_runs');
	if (!hasTable) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn(
		'list_reconcile_runs',
		'exclude_skipped',
	);
	if (hasColumn) {
		return;
	}
	await instance.schema.table('list_reconcile_runs', (t) => {
		t.integer('exclude_skipped');
	});
	const message = '[migrate] list_reconcile_runs.exclude_skipped column added';
	if (onLog) {
		onLog(message);
	} else {
		// eslint-disable-next-line no-console
		console.error(message);
	}
}
