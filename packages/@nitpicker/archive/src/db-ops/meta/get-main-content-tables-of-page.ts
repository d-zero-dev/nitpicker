import type { MainContentTableRow } from '../../meta/types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all `page_main_content_tables` rows for the given page id, in
 * DOM traversal order.
 *
 * Read-side counterpart to `insertMainContentTables`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getMainContentTablesOfPage(
	knex: Knex,
	pageId: number,
): Promise<MainContentTableRow[]> {
	return knex
		.select<
			MainContentTableRow[]
		>('id', 'pageId', 'order', 'rows', 'cols', 'hasHeader', 'hasFooter', 'hasMergedCell')
		.from('page_main_content_tables')
		.where('pageId', pageId)
		.orderBy('order', 'asc');
}
