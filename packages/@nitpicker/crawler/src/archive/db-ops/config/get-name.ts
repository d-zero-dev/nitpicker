import type { Config } from '../../types.js';
import type { Knex } from 'knex';

/**
 * Retrieves the crawl session name from the `info` table.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns The name string.
 * @throws {Error} If no name is found in the database.
 */
export async function getName(knex: Knex): Promise<string> {
	const selected = await knex.select('name').from<Config>('info');
	if (!selected[0]) {
		throw new Error('No name');
	}
	const [{ name }] = selected;
	return name;
}
