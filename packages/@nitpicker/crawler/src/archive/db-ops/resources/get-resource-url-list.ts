import type { Knex } from 'knex';

/**
 * Retrieves a flat list of all resource URLs from the `resource_items`
 * table. URL text is normalised into `url_refs`, so the read joins the
 * two tables and returns the resolved strings.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns An array of resource URL strings.
 */
export async function getResourceUrlList(knex: Knex): Promise<string[]> {
	const res = await knex('resource_items')
		.join('url_refs', 'url_refs.id', 'resource_items.url_id')
		.select('url_refs.url as url');
	return res.map((r) => r.url);
}
