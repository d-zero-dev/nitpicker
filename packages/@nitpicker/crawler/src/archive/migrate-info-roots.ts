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
 */
export async function migrateInfoRoots(instance: Knex): Promise<void> {
	const hasInfo = await instance.schema.hasTable('info');
	if (!hasInfo) {
		return;
	}
	const hasRoots = await instance.schema.hasColumn('info', 'roots');
	const hasScope = await instance.schema.hasColumn('info', 'scope');
	if (hasRoots && !hasScope) {
		return;
	}
	if (!hasRoots) {
		await instance.schema.table('info', (t) => {
			t.json('roots');
		});
		await instance.raw(
			`UPDATE info SET roots = json_array(baseUrl) WHERE roots IS NULL AND baseUrl IS NOT NULL`,
		);
		await instance.raw(`UPDATE info SET roots = '[]' WHERE roots IS NULL`);
	}
	if (hasScope) {
		await instance.schema.table('info', (t) => {
			t.dropColumn('scope');
		});
	}
	// eslint-disable-next-line no-console
	console.error('[migrate] info table upgraded (roots seeded, scope dropped)');
}
