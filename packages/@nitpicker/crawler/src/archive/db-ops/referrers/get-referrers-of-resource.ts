import type { Knex } from 'knex';

/**
 * Retrieves the page URLs that reference a specific resource.
 * @param knex - Knex query builder connected to the archive DB.
 * @param id - The database ID of the resource.
 * @returns An array of page URL strings that reference the resource.
 */
export async function getReferrersOfResource(knex: Knex, id: number): Promise<string[]> {
	const res = await knex
		.select('url_refs.url as url')
		.from('resource_ref_edges')
		.join('content_items', 'content_items.id', '=', 'resource_ref_edges.page_id')
		.join('url_refs', 'url_refs.id', '=', 'content_items.url_id')
		.where('resource_ref_edges.resource_id', id);
	return res.map((r) => r.url);
}
