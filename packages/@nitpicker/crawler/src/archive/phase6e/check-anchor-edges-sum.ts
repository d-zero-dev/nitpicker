import type { Knex } from 'knex';

import { Phase6VerificationError } from './types.js';

/**
 * Verifies Phase 6-E invariant #4: the sum of `anchor_edges.count` equals the
 * total number of legacy `anchors` rows.
 *
 * Phase 6-D-4 collapses N `anchors` rows per `(pageId, hrefId)` pair into a
 * single edge with `count = N`; the invariant re-establishes the identity
 * `sum(count) = number of source rows`. Together with invariant #3 this
 * proves the dedup is exact (no rows lost, no rows double-counted).
 * @param trx - Knex instance or transaction connected to the post-6-D archive.
 * @throws {Phase6VerificationError} when the sum diverges from the anchors row count.
 */
export async function checkAnchorEdgesSum(trx: Knex): Promise<void> {
	const sumRows = await trx('anchor_edges').sum<{ n: number | null }[]>({ n: 'count' });
	const anchorsRows = await trx('anchors').count<{ n: number }[]>({ n: '*' });
	const anchorEdgesSum = Number(sumRows[0]!.n ?? 0);
	const anchorsCount = Number(anchorsRows[0]!.n);
	if (anchorEdgesSum !== anchorsCount) {
		throw new Phase6VerificationError({
			check: '#4 anchor_edges count sum',
			context: {
				sum_of_anchor_edges_count: anchorEdgesSum,
				anchors: anchorsCount,
			},
		});
	}
}
