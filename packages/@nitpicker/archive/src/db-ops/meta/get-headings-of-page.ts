import type { MainContentHeadingRow } from '../../meta/types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all `page_main_content_headings` rows for the given page id, in
 * DOM traversal order.
 *
 * Read-side counterpart to `insertHeadings`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getHeadingsOfPage(
	knex: Knex,
	pageId: number,
): Promise<MainContentHeadingRow[]> {
	return knex
		.select<MainContentHeadingRow[]>('id', 'pageId', 'order', 'text', 'level')
		.from('page_main_content_headings')
		.where('pageId', pageId)
		.orderBy('order', 'asc');
}
