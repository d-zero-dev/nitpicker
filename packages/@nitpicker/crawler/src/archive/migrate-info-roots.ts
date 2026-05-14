import type { Knex } from 'knex';

/**
 * Add the `info.roots` JSON column to legacy archives that predate the
 * multi-root feature, seeding it with `[baseUrl]` so that downstream code can
 * always read a populated array.
 *
 * Idempotent: calling this multiple times on an up-to-date schema is a no-op.
 * Tolerates archives where `baseUrl` is NULL — those receive an empty `roots`
 * array rather than throwing.
 *
 * When the migration actually runs (i.e. the column was missing), a single
 * notice is written to stderr so the user knows the file was upgraded.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateInfoRoots(instance: Knex): Promise<void> {
	const hasInfo = await instance.schema.hasTable('info');
	if (!hasInfo) {
		return;
	}
	const hasRoots = await instance.schema.hasColumn('info', 'roots');
	if (hasRoots) {
		return;
	}
	await instance.schema.table('info', (t) => {
		t.json('roots');
	});
	await instance.raw(
		`UPDATE info SET roots = json_array(baseUrl) WHERE roots IS NULL AND baseUrl IS NOT NULL`,
	);
	await instance.raw(`UPDATE info SET roots = '[]' WHERE roots IS NULL`);
	// eslint-disable-next-line no-console
	console.error('[migrate] info.roots column added (seeded with baseUrl)');
}
