import type { MainContentsData } from '@d-zero/beholder';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';

/**
 * Replaces the page's `page_main_content_headings` rows with the freshly
 * captured set. Called inside `updatePage`'s transaction, gated on
 * `mainContents !== null` (non-HTML / external / metadata-only scrapes have
 * no main-content data to write).
 *
 * Same empty-guard as `insertTags` / `insertJsonLd`: an empty array does not
 * wipe prior rows on a degraded re-scrape.
 * @param pageId - The owning `content_items.id`.
 * @param mainContents - Beholder's per-page main-content metrics.
 * @param trx - The active transaction.
 */
export async function insertHeadings(
	pageId: number,
	mainContents: MainContentsData,
	trx: Knex.Transaction,
): Promise<void> {
	if (mainContents.headings.length === 0) return;
	const rows = mainContents.headings.map((heading, order) => ({
		pageId,
		order,
		text: heading.text,
		level: heading.level,
	}));
	await trx('page_main_content_headings').where('pageId', pageId).delete();
	await eachSplitted(rows, 100, async (chunk) => {
		await trx('page_main_content_headings').insert(chunk);
	});
}
