import type { Knex } from 'knex';

/**
 * Adds the `info.createdCwd` column to archives created before it existed.
 * `CREATE TABLE IF NOT EXISTS` (used for `info` itself) cannot retrofit a new
 * column onto an already-existing table, so this lightweight,
 * `hasColumn`-guarded `ALTER TABLE` runs on every `initSchema` call —
 * idempotent, and self-healing for archives whose provisioning crashed
 * partway through. A stub missing this column simply falls back to
 * `Archive.resume`'s own `process.cwd()`, same as before this column existed.
 * @param instance - The Knex query builder instance connected to the database.
 * @param onLog - Called instead of `console.error` when this migration
 *   actually applies (issue #294: a bare `console.error` here can fire
 *   while a `@d-zero/dealer` `Lanes`/`TaskList` display is mid-redraw during
 *   `Archive.open`, corrupting its cursor tracking). Falls back to
 *   `console.error` when omitted (direct/test callers).
 */
export async function migrateInfoCreatedCwd(
	instance: Knex,
	onLog?: (message: string) => void,
): Promise<void> {
	const hasInfo = await instance.schema.hasTable('info');
	if (!hasInfo) {
		return;
	}
	const hasColumn = await instance.schema.hasColumn('info', 'createdCwd');
	if (hasColumn) {
		return;
	}
	await instance.schema.table('info', (t) => {
		t.string('createdCwd');
	});
	const message = '[migrate] info.createdCwd column added';
	if (onLog) {
		onLog(message);
	} else {
		// eslint-disable-next-line no-console
		console.error(message);
	}
}
