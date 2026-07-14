import type { Knex } from 'knex';

import { Phase6VerificationError } from './types.js';

/**
 * Verifies Phase 6-E invariant #2: every scraped page has one `page_meta`
 * row.
 *
 * `page_meta` mirrors the meta columns of `pages` for `scraped = 1` rows
 * only (see `populate-page-meta.ts`); un-scraped pages have no meta to
 * carry. A mismatch usually indicates that the populate loop encountered a
 * scraped page whose meta resolution failed silently (e.g. a text ref that
 * did not deduplicate), in which case the archive would be missing meta for
 * an otherwise valid page.
 * @param trx - Knex instance or transaction connected to the post-6-D archive.
 * @throws {Phase6VerificationError} when the row counts diverge.
 */
export async function checkPageMetaCount(trx: Knex): Promise<void> {
	const pageMetaRows = await trx('page_meta').count<{ n: number }[]>({ n: '*' });
	const scrapedPagesRows = await trx('pages')
		.where('scraped', true)
		.count<{ n: number }[]>({ n: '*' });
	const pageMetaCount = Number(pageMetaRows[0]!.n);
	const scrapedPagesCount = Number(scrapedPagesRows[0]!.n);
	if (pageMetaCount !== scrapedPagesCount) {
		throw new Phase6VerificationError({
			check: '#2 page_meta row count',
			context: {
				page_meta: pageMetaCount,
				scraped_pages: scrapedPagesCount,
			},
		});
	}
}
