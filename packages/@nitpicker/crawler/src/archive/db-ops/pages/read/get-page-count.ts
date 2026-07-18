import type { Knex } from 'knex';

import { dbLog } from '../../../debug.js';

/**
 * Counts the total number of pages in the database.
 *
 * Pages live in `content_items` (resources are a physically separate
 * `resource_items` table), so a bare count needs no type discriminator
 * and no join.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns The total page count.
 * @throws {Error} If the count query fails.
 */
export async function getPageCount(knex: Knex): Promise<number> {
	const selected = await knex.count('id').from('content_items');
	if (!selected[0]) {
		throw new Error('No count');
	}
	// @ts-expect-error
	const count: number = selected[0]['count(`id`)'];
	dbLog('Number of pages: %d', count);
	return count;
}
