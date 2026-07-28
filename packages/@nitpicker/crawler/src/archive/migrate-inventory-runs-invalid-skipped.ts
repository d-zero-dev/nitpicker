import type { Knex } from 'knex';

/**
 * Adds the `inventory_runs.invalid_skipped` column to archives created
 * before it existed. `CREATE TABLE IF NOT EXISTS` (used for `inventory_runs`
 * itself) cannot retrofit a new column onto an already-existing table, so
 * this lightweight, `hasColumn`-guarded `ALTER TABLE` runs on every
 * `initSchema` call — idempotent, and self-healing for archives whose
 * provisioning crashed partway through.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateInventoryRunsInvalidSkipped(instance: Knex): Promise<void> {
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
	// eslint-disable-next-line no-console
	console.error('[migrate] inventory_runs.invalid_skipped column added');
}
