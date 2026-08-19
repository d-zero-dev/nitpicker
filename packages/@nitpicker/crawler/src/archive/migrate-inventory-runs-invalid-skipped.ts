import type { Knex } from 'knex';

/**
 * Adds the `inventory_runs.invalid_skipped` column to archives created
 * before it existed. `CREATE TABLE IF NOT EXISTS` (used for `inventory_runs`
 * itself) cannot retrofit a new column onto an already-existing table, so
 * this lightweight, `hasColumn`-guarded `ALTER TABLE` runs on every
 * `initSchema` call — idempotent, and self-healing for archives whose
 * provisioning crashed partway through.
 * @param instance - The Knex query builder instance connected to the database.
 * @param onLog - Called instead of `console.error` when this migration
 *   actually applies (issue #294: a bare `console.error` here can fire
 *   while a `@d-zero/dealer` `Lanes`/`TaskList` display is mid-redraw during
 *   `Archive.open`, corrupting its cursor tracking). Falls back to
 *   `console.error` when omitted (direct/test callers).
 */
export async function migrateInventoryRunsInvalidSkipped(
	instance: Knex,
	onLog?: (message: string) => void,
): Promise<void> {
	const hasTable = await instance.schema.hasTable('inventory_runs');
	if (!hasTable) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn('inventory_runs', 'invalid_skipped');
	if (hasColumn) {
		return;
	}
	await instance.schema.table('inventory_runs', (t) => {
		t.integer('invalid_skipped');
	});
	const message = '[migrate] inventory_runs.invalid_skipped column added';
	if (onLog) {
		onLog(message);
	} else {
		// eslint-disable-next-line no-console
		console.error(message);
	}
}
