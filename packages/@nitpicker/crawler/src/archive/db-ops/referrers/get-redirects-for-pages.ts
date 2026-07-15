import type { DB_Redirect } from '../../types.js';
import type { Knex } from 'knex';

/**
 * Retrieves redirect sources for the given page IDs in bulk.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageIds - The database IDs of the destination pages.
 * @returns An array of {@link DB_Redirect} records mapping destination pages to their redirect sources.
 */
export async function getRedirectsForPages(
	knex: Knex,
	pageIds: number[],
): Promise<DB_Redirect[]> {
	if (pageIds.length === 0) return [];
	return knex
		.select('redirectDestId as pageId', 'url as from', 'id as fromId')
		.from('pages')
		.whereIn('redirectDestId', pageIds);
}
