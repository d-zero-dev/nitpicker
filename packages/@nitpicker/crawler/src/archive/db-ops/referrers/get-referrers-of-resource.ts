import type { Knex } from 'knex';

/**
 * Retrieves the page URLs that reference a specific resource.
 * @param knex - Knex query builder connected to the archive DB.
 * @param id - The database ID of the resource.
 * @returns An array of page URL strings that reference the resource.
 */
export async function getReferrersOfResource(knex: Knex, id: number): Promise<string[]> {
	const res = await knex
		.select('pages.url')
		.from('resources-referrers')
		.join('resources', 'resources.id', '=', 'resources-referrers.resourceId')
		.join('pages', 'pages.id', '=', 'resources-referrers.pageId')
		.where('resources.id', id);
	return res.map((r) => r.url);
}
