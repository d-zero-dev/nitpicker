import type { PageData } from '../../../../utils/types/types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';
import { extractTagsForArchive } from '../../../meta/extract-tags-for-archive.js';

/**
 * Replaces the page's Wappalyzer tag rows with the freshly captured set.
 * Called inside `updatePage`'s transaction unconditionally — tag
 * detection draws on `<script src>` / `<iframe src>` / window globals /
 * response headers, not the HTML body, so external pages that skip
 * rendering still contribute tags.
 *
 * Same empty-guard as `insertJsonLd`: an empty array does not wipe
 * prior rows on a degraded re-scrape.
 * @param pageId
 * @param meta
 * @param trx
 */
export async function insertTags(
	pageId: number,
	meta: PageData['meta'],
	trx: Knex.Transaction,
): Promise<void> {
	const partial = extractTagsForArchive(meta.tags);
	if (partial.length === 0) return;
	const rows = partial.map((p) => ({
		pageId,
		provider: p.provider,
		category: p.category,
		externalId: p.externalId,
		version: p.version,
		confidence: p.confidence,
		categories: JSON.stringify(p.categories),
		sources: JSON.stringify(p.sources),
	}));
	await trx('page_tags').where('pageId', pageId).delete();
	await eachSplitted(rows, 100, async (chunk) => {
		await trx('page_tags').insert(chunk);
	});
}
