import type { MainContentCustomElementRow } from '../../meta/types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all `page_main_content_custom_elements` rows for the given page
 * id, in DOM traversal order.
 *
 * Read-side counterpart to `insertCustomElements`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getCustomElementsOfPage(
	knex: Knex,
	pageId: number,
): Promise<MainContentCustomElementRow[]> {
	return knex
		.select<
			MainContentCustomElementRow[]
		>('id', 'pageId', 'order', 'nodeName', 'elementId', 'classList')
		.from('page_main_content_custom_elements')
		.where('pageId', pageId)
		.orderBy('order', 'asc');
}
