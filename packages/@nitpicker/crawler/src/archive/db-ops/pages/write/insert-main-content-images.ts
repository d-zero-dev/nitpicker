import type { MainContentsData } from '@d-zero/beholder';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';

/**
 * Replaces the page's `page_main_content_images` rows with the freshly
 * captured set. Called inside `updatePage`'s transaction, gated on
 * `mainContents !== null`.
 *
 * Distinct from `image_items` (the whole-page image scan, `replaceImageItems`):
 * this table only covers images inside the detected main-content region, so
 * `src` is stored as a plain string rather than routed through
 * `url_refs` / `blob_refs` — same low-cross-page-reuse rationale as the
 * `page_meta.main_content_*` columns.
 *
 * Same empty-guard as `insertTags` / `insertJsonLd`: an empty array does not
 * wipe prior rows on a degraded re-scrape.
 * @param pageId - The owning `content_items.id`.
 * @param mainContents - Beholder's per-page main-content metrics.
 * @param trx - The active transaction.
 */
export async function insertMainContentImages(
	pageId: number,
	mainContents: MainContentsData,
	trx: Knex.Transaction,
): Promise<void> {
	if (mainContents.images.length === 0) return;
	const rows = mainContents.images.map((image, order) => ({
		pageId,
		order,
		src: image.src,
		alt: image.alt,
	}));
	await trx('page_main_content_images').where('pageId', pageId).delete();
	await eachSplitted(rows, 100, async (chunk) => {
		await trx('page_main_content_images').insert(chunk);
	});
}
