import type { MainContentsData } from '@d-zero/beholder';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';

/**
 * Replaces the page's `page_main_content_videos` rows with the freshly
 * captured set. Called inside `updatePage`'s transaction, gated on
 * `mainContents !== null`.
 *
 * Same empty-guard as `insertTags` / `insertJsonLd`: an empty array does not
 * wipe prior rows on a degraded re-scrape.
 * @param pageId - The owning `content_items.id`.
 * @param mainContents - Beholder's per-page main-content metrics.
 * @param trx - The active transaction.
 */
export async function insertVideos(
	pageId: number,
	mainContents: MainContentsData,
	trx: Knex.Transaction,
): Promise<void> {
	if (mainContents.videos.length === 0) return;
	const rows = mainContents.videos.map((video, order) => ({
		pageId,
		order,
		src: video.src,
		poster: video.poster,
		width: video.width,
		height: video.height,
	}));
	await trx('page_main_content_videos').where('pageId', pageId).delete();
	await eachSplitted(rows, 100, async (chunk) => {
		await trx('page_main_content_videos').insert(chunk);
	});
}
