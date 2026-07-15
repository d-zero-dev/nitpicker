import type { DB_Resource } from '../../types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all sub-resources from the `resources` table.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns An array of raw {@link DB_Resource} rows.
 */
export async function getResources(knex: Knex): Promise<DB_Resource[]> {
	return knex.select('*').from<DB_Resource>('resources');
}
