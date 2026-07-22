import type { MainContentVideoRow } from '../../meta/types.js';
import type { Knex } from 'knex';

/**
 * Retrieves all `page_main_content_videos` rows for the given page id, in
 * DOM traversal order.
 *
 * Read-side counterpart to `insertVideos`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId
 */
export async function getVideosOfPage(
	knex: Knex,
	pageId: number,
): Promise<MainContentVideoRow[]> {
	return knex
		.select<
			MainContentVideoRow[]
		>('id', 'pageId', 'order', 'src', 'poster', 'width', 'height')
		.from('page_main_content_videos')
		.where('pageId', pageId)
		.orderBy('order', 'asc');
}
