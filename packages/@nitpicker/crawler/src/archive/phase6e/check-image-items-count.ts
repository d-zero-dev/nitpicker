import type { Knex } from 'knex';

import { Phase6VerificationError } from './types.js';

/**
 * Verifies Phase 6-E invariant #5: every legacy `images` row is mirrored by
 * one row in `image_items`.
 *
 * Phase 6-D-6 populates `image_items` with the same PK as `images.id` (see
 * `populate-image-items.ts`); the invariant is broken only if the populate
 * loop skipped rows during URL/blob routing or dom-path derivation.
 * @param trx - Knex instance or transaction connected to the post-6-D archive.
 * @throws {Phase6VerificationError} when the row counts diverge.
 */
export async function checkImageItemsCount(trx: Knex): Promise<void> {
	const imageItemsRows = await trx('image_items').count<{ n: number }[]>({ n: '*' });
	const imagesRows = await trx('images').count<{ n: number }[]>({ n: '*' });
	const imageItemsCount = Number(imageItemsRows[0]!.n);
	const imagesCount = Number(imagesRows[0]!.n);
	if (imageItemsCount !== imagesCount) {
		throw new Phase6VerificationError({
			check: '#5 image_items row count',
			context: {
				image_items: imageItemsCount,
				images: imagesCount,
			},
		});
	}
}
