import type { Knex } from 'knex';

import { MigrationVerificationError } from './types.js';

/**
 * Verifies 0.13 invariant #3: the `anchor_edges` dedup does not
 * eliminate rows and does not create phantom rows.
 *
 * 0.13-4 collapses N `anchors` rows per `(pageId, hrefId)` pair into a
 * single `anchor_edges` row with `count = N`. Two ways it could go wrong:
 *
 * - `count(anchor_edges) == 0 && count(anchors) > 0` — dedup annihilated
 *   the graph. A populate bug or a group-by mis-key would trip this.
 * - `count(anchor_edges) > count(anchors)` — dedup produced more rows than
 *   inputs. Impossible under a correct `GROUP BY` but a phantom-insert bug
 *   in the populate loop would trip this.
 *
 * `count(anchor_edges) == count(anchors)` is **not** a failure. Issue #194
 * spelled the upper bound as `< count(anchors)` (strict), but a legitimate
 * small crawl where every `(pageId, hrefId)` pair is unique produces one
 * edge per anchor (count=1) and satisfies the identity naturally. Enforcing
 * strict `<` would refuse to migrate such archives even though every other
 * invariant holds; the true invariant is "no rows added or dropped by
 * dedup" (`anchor_edges <= anchors`), so the code enforces the weaker,
 * correct clause. Check #4 (`SUM(count) == count(anchors)`) already
 * establishes that no rows were silently discarded when the counts happen
 * to match.
 *
 * A trivial archive with zero `anchors` legitimately produces zero
 * `anchor_edges`, so both counts being zero passes; a non-zero `anchor_edges`
 * with a zero `anchors` still throws — that would mean rows appeared from
 * nowhere.
 * @param trx - Knex instance or transaction connected to the populated archive.
 * @throws {MigrationVerificationError} when the invariant is violated.
 */
export async function checkAnchorEdgesCount(trx: Knex): Promise<void> {
	const anchorEdgesRows = await trx('anchor_edges').count<{ n: number }[]>({ n: '*' });
	const anchorsRows = await trx('anchors').count<{ n: number }[]>({ n: '*' });
	const anchorEdgesCount = Number(anchorEdgesRows[0]!.n);
	const anchorsCount = Number(anchorsRows[0]!.n);
	if (anchorsCount === 0) {
		if (anchorEdgesCount !== 0) {
			throw new MigrationVerificationError({
				check: '#3 anchor_edges row count',
				context: {
					anchor_edges: anchorEdgesCount,
					anchors: anchorsCount,
					reason: 'anchor_edges must be empty when anchors is empty',
				},
			});
		}
		return;
	}
	if (anchorEdgesCount === 0) {
		throw new MigrationVerificationError({
			check: '#3 anchor_edges row count',
			context: {
				anchor_edges: anchorEdgesCount,
				anchors: anchorsCount,
				reason: 'anchor_edges must be greater than zero when anchors is non-empty',
			},
		});
	}
	if (anchorEdgesCount > anchorsCount) {
		throw new MigrationVerificationError({
			check: '#3 anchor_edges row count',
			context: {
				anchor_edges: anchorEdgesCount,
				anchors: anchorsCount,
				reason: 'anchor_edges must not exceed anchors (dedup should not create rows)',
			},
		});
	}
}
