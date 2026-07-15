import type { Knex } from 'knex';

/**
 * Retrieves all anchors (outgoing links) on a specific page.
 * Joins the `anchors` table with the `pages` table to resolve link destinations.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId - The database ID of the page whose anchors to retrieve.
 * @returns An array of anchor records with resolved URL, title, status, and content type.
 */
export async function getAnchorsOnPage(knex: Knex, pageId: number) {
	const res = await knex
		.select(
			'pages.url',
			'pages.title',
			'pages.status',
			'pages.statusText',
			'pages.contentType',
			'anchors.hash',
			'anchors.textContent',
		)
		.from('anchors')
		.join('pages', 'anchors.hrefId', '=', 'pages.id')
		.where('anchors.pageId', pageId);
	return res;
}
