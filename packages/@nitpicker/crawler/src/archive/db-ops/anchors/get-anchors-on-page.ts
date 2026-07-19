import type { Knex } from 'knex';

/**
 * Retrieves all anchors (outgoing links) on a specific page.
 * Joins `anchor_edges` with `content_items` (+ `page_meta` for title) to
 * resolve link destinations.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId - The database ID of the page whose anchors to retrieve.
 * @returns An array of anchor records with resolved URL, title, status, and content type.
 */
export async function getAnchorsOnPage(knex: Knex, pageId: number) {
	const res = await knex
		.select(
			'dest_url.url as url',
			'title_ref.text as title',
			'dest.status as status',
			'dest.status_text as statusText',
			'ctr.raw as contentType',
			'anchor_edges.first_hash as hash',
			'first_text.text as textContent',
		)
		.from('anchor_edges')
		.join('content_items as dest', 'anchor_edges.href_page_id', '=', 'dest.id')
		.join('url_refs as dest_url', 'dest.url_id', '=', 'dest_url.id')
		.leftJoin('content_type_refs as ctr', 'dest.content_type_id', '=', 'ctr.id')
		.leftJoin('page_meta as pm', 'dest.id', '=', 'pm.page_id')
		.leftJoin('text_refs as title_ref', 'pm.title_text_id', '=', 'title_ref.id')
		.leftJoin(
			'text_refs as first_text',
			'anchor_edges.first_text_id',
			'=',
			'first_text.id',
		)
		.where('anchor_edges.page_id', pageId);
	return res;
}
