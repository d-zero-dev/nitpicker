import type { Knex } from 'knex';

/**
 * Bring an archive's `info` table to the current shape: add `roots` (seeded
 * from `baseUrl`) and drop the obsolete `scope` column.
 *
 * Idempotent: calling this multiple times on an up-to-date schema is a no-op.
 * Archives where `baseUrl` is NULL receive an empty `roots` array rather than
 * throwing.
 *
 * When the migration actually runs (i.e. either column transition was
 * performed), a single notice is written to stderr so the user knows the
 * file was upgraded.
 * @param instance - The Knex query builder instance connected to the database.
 * @param onLog - Called instead of `console.error` when this migration
 *   actually applies (issue #294: a bare `console.error` here can fire
 *   while a `@d-zero/dealer` `Lanes`/`TaskList` display is mid-redraw during
 *   `Archive.open`, corrupting its cursor tracking). Falls back to
 *   `console.error` when omitted (direct/test callers).
 */
export async function migrateInfoRoots(
	instance: Knex,
	onLog?: (message: string) => void,
): Promise<void> {
	const hasInfo = await instance.schema.hasTable('info');
	if (!hasInfo) {
		return;
	}
	const hasRoots = await instance.schema.hasColumn('info', 'roots');
	const hasScope = await instance.schema.hasColumn('info', 'scope');
	if (hasRoots && !hasScope) {
		return;
	}
	const changes: string[] = [];
	if (!hasRoots) {
		await instance.schema.table('info', (t) => {
			t.json('roots');
		});
		await instance.raw(
			`UPDATE info SET roots = json_array(baseUrl) WHERE roots IS NULL AND baseUrl IS NOT NULL`,
		);
		await instance.raw(`UPDATE info SET roots = '[]' WHERE roots IS NULL`);
		changes.push('roots seeded');
	}
	if (hasScope) {
		await instance.schema.table('info', (t) => {
			t.dropColumn('scope');
		});
		changes.push('scope dropped');
	}
	const message = `[migrate] info table upgraded (${changes.join(', ')})`;
	if (onLog) {
		onLog(message);
	} else {
		// eslint-disable-next-line no-console
		console.error(message);
	}
}
