import type { MainContentImageRow } from '../../meta/types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all `page_main_content_images` rows for the given page id, in
 * DOM traversal order.
 *
 * Read-side counterpart to `insertMainContentImages`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getMainContentImagesOfPage(
	knex: Knex,
	pageId: number,
): Promise<MainContentImageRow[]> {
	return knex
		.select<MainContentImageRow[]>('id', 'pageId', 'order', 'src', 'alt')
		.from('page_main_content_images')
		.where('pageId', pageId)
		.orderBy('order', 'asc');
}
