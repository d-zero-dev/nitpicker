import type { ListViewerImagesOptions } from './types.js';
import type { Knex } from 'knex';

import { applyViewerImagesFilters } from './apply-viewer-images-filters.js';

/**
 * Resolves the total matching row count for `/api/images`'s `viewer_images`
 * fast path: a live `COUNT(*)` against the narrow `viewer_images` table
 * (never the wide write-model `images` table), with the same filters the
 * id-resolution query applies.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter/sort options.
 * @returns The total number of matching rows.
 */
export async function countViewerImagesTotal(
	knex: Knex,
	options: ListViewerImagesOptions,
): Promise<number> {
	const qb = knex('viewer_images');
	applyViewerImagesFilters(qb, options);
	const result = await qb.count<{ count: string }[]>({ count: '*' });
	return Number(result[0]?.count ?? 0);
}
