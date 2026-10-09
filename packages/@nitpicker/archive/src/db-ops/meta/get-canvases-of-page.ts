import type { MainContentCanvasRow } from '../../meta/types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all `page_main_content_canvases` rows for the given page id, in
 * DOM traversal order.
 *
 * Read-side counterpart to `insertCanvases`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getCanvasesOfPage(
	knex: Knex,
	pageId: number,
): Promise<MainContentCanvasRow[]> {
	return knex
		.select<MainContentCanvasRow[]>('id', 'pageId', 'order', 'width', 'height')
		.from('page_main_content_canvases')
		.where('pageId', pageId)
		.orderBy('order', 'asc');
}
