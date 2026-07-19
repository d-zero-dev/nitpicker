import type { DB_Resource } from '../../types.js';
import type { Knex } from 'knex';

import { buildResourceQuery } from './build-resource-query.js';
import { reconstructResourceRows } from './reconstruct-resource-rows.js';

/**
 * Retrieves all sub-resources.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns An array of reconstructed {@link DB_Resource} rows.
 */
export async function getResources(knex: Knex): Promise<DB_Resource[]> {
	const rows = await buildResourceQuery(knex);
	return reconstructResourceRows(knex, rows);
}
