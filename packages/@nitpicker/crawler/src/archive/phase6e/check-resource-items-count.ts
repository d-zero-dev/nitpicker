import type { Knex } from 'knex';

import { Phase6VerificationError } from './types.js';

/**
 * Verifies Phase 6-E invariant #6: every legacy `resources` row is mirrored
 * by one row in `resource_items`.
 *
 * Phase 6-D-3 populates `resource_items` with the same PK as `resources.id`
 * (see `populate-resource-items.ts`); the invariant is broken only if the
 * populate loop skipped rows during URL / header-set / content-type
 * resolution. The paired invariant `resource_ref_edges = "resources-referrers"`
 * is left unchecked here because issue #194's spec list stops at the
 * six enumerated checks, and `resource_ref_edges` populate is a straight
 * `INSERT … SELECT` (no dedup, no resolution) with negligible failure surface.
 * @param trx - Knex instance or transaction connected to the post-6-D archive.
 * @throws {Phase6VerificationError} when the row counts diverge.
 */
export async function checkResourceItemsCount(trx: Knex): Promise<void> {
	const resourceItemsRows = await trx('resource_items').count<{ n: number }[]>({
		n: '*',
	});
	const resourcesRows = await trx('resources').count<{ n: number }[]>({ n: '*' });
	const resourceItemsCount = Number(resourceItemsRows[0]!.n);
	const resourcesCount = Number(resourcesRows[0]!.n);
	if (resourceItemsCount !== resourcesCount) {
		throw new Phase6VerificationError({
			check: '#6 resource_items row count',
			context: {
				resource_items: resourceItemsCount,
				resources: resourcesCount,
			},
		});
	}
}
