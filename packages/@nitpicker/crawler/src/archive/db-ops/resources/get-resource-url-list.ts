import type { DB_Resource } from '../../types.js';
import type { Knex } from 'knex';

/**
 * Retrieves a flat list of all resource URLs from the `resources` table.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns An array of resource URL strings.
 */
export async function getResourceUrlList(knex: Knex): Promise<string[]> {
	const res = await knex.select('url').from<DB_Resource>('resources');
	return res.map((r) => r.url);
}
