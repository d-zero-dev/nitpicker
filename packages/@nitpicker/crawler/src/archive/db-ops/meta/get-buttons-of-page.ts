import type { MainContentButtonRow } from '../../meta/types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all `page_main_content_buttons` rows for the given page id, in
 * DOM traversal order.
 *
 * Read-side counterpart to `insertButtons`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getButtonsOfPage(
	knex: Knex,
	pageId: number,
): Promise<MainContentButtonRow[]> {
	return knex
		.select<
			MainContentButtonRow[]
		>('id', 'pageId', 'order', 'nodeName', 'role', 'type', 'text', 'disabled')
		.from('page_main_content_buttons')
		.where('pageId', pageId)
		.orderBy('order', 'asc');
}
