import type { MainContentAudioRow } from '../../meta/types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all `page_main_content_audios` rows for the given page id, in
 * DOM traversal order.
 *
 * Read-side counterpart to `insertAudios`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getAudiosOfPage(
	knex: Knex,
	pageId: number,
): Promise<MainContentAudioRow[]> {
	return knex
		.select<MainContentAudioRow[]>('id', 'pageId', 'order', 'src')
		.from('page_main_content_audios')
		.where('pageId', pageId)
		.orderBy('order', 'asc');
}
