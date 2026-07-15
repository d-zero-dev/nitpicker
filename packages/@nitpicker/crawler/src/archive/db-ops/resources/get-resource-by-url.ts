import type { DB_Resource } from '../../types.js';
import type { Knex } from 'knex';

/**
 * Retrieves a single sub-resource from the `resources` table by its URL.
 *
 * Accepts multiple URL candidates because the stored key is the resource's
 * `href` while callers may only know the hash-stripped form; the first match
 * wins.
 * @param knex - Knex query builder connected to the archive DB.
 * @param urls - URL candidates to match against the `url` column.
 * @returns The raw {@link DB_Resource} row, or `null` if none match.
 */
export async function getResourceByUrl(
	knex: Knex,
	urls: readonly string[],
): Promise<DB_Resource | null> {
	const res = await knex
		.select('*')
		.from<DB_Resource>('resources')
		.whereIn('url', [...urls])
		.first();
	return res ?? null;
}
