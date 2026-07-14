import type { Knex } from 'knex';

import { Phase6VerificationError } from './types.js';

/**
 * Verifies Phase 6-E invariant #1: every legacy `pages` row is mirrored by
 * one row in `content_items`.
 *
 * Phase 6-D-1 populates `content_items` with `id = pages.id` for every page
 * (see `populate-content-items.ts`); the invariant is broken only if the
 * populate loop skipped or double-inserted rows. `INSERT OR IGNORE` on the
 * PK collapses duplicates, so a mismatch always means "populate wrote
 * fewer rows than expected" (extra rows would be impossible via the natural
 * PK). We still emit both counts in the error context so operators can see
 * the direction of the discrepancy at a glance.
 * @param trx - Knex instance or transaction connected to the post-6-D archive.
 * @throws {Phase6VerificationError} when the row counts diverge.
 */
export async function checkContentItemsCount(trx: Knex): Promise<void> {
	const contentItemsRows = await trx('content_items').count<{ n: number }[]>({ n: '*' });
	const pagesRows = await trx('pages').count<{ n: number }[]>({ n: '*' });
	const contentItemsCount = Number(contentItemsRows[0]!.n);
	const pagesCount = Number(pagesRows[0]!.n);
	if (contentItemsCount !== pagesCount) {
		throw new Phase6VerificationError({
			check: '#1 content_items row count',
			context: {
				content_items: contentItemsCount,
				pages: pagesCount,
			},
		});
	}
}
