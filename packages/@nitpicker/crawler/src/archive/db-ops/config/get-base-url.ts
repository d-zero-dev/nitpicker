import type { Config } from '../../types.js';
import type { Knex } from 'knex';

/**
 * Retrieves the base URL of the crawl session from the `info` table.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns The base URL string.
 * @throws {Error} If no base URL is found in the database.
 */
export async function getBaseUrl(knex: Knex): Promise<string> {
	const selected = await knex.select('baseUrl').from<Config>('info');
	if (!selected[0]) {
		throw new Error('No baseUrl');
	}
	const [{ baseUrl }] = selected;
	return baseUrl || '';
}
