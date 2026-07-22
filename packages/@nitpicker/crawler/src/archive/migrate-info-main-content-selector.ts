import type { Knex } from 'knex';

/**
 * Adds the `info.mainContentSelector` column to archives created before it
 * existed. `CREATE TABLE IF NOT EXISTS` (used for `info` itself) cannot
 * retrofit a new column onto an already-existing table, so this lightweight,
 * `hasColumn`-guarded `ALTER TABLE` runs on every `initSchema` call —
 * idempotent, and self-healing for archives whose provisioning crashed
 * partway through.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateInfoMainContentSelector(instance: Knex): Promise<void> {
	const hasInfo = await instance.schema.hasTable('info');
	if (!hasInfo) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn('info', 'mainContentSelector');
	if (hasColumn) {
		return;
	}
	await instance.schema.table('info', (t) => {
		t.string('mainContentSelector');
	});
	// eslint-disable-next-line no-console
	console.error('[migrate] info.mainContentSelector column added');
}
