import type { MainContentIframeRow } from '../../meta/types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all `page_main_content_iframes` rows for the given page id, in
 * DOM traversal order.
 *
 * Read-side counterpart to `insertIframes`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getIframesOfPage(
	knex: Knex,
	pageId: number,
): Promise<MainContentIframeRow[]> {
	return knex
		.select<
			MainContentIframeRow[]
		>('id', 'pageId', 'order', 'src', 'title', 'width', 'height')
		.from('page_main_content_iframes')
		.where('pageId', pageId)
		.orderBy('order', 'asc');
}
