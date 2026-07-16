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
		.select(
			'content_items.redirect_dest_id as pageId',
			'url_refs.url as from',
			'content_items.id as fromId',
		)
		.from('content_items')
		.join('url_refs', 'url_refs.id', '=', 'content_items.url_id')
		.whereIn('content_items.redirect_dest_id', pageIds);
}
