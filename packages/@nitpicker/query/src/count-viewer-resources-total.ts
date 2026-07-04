import type { ListViewerResourcesOptions } from './types.js';
import type { Knex } from 'knex';

import { applyViewerResourcesFilters } from './apply-viewer-resources-filters.js';

/**
 * Resolves the total matching row count for `/api/resources`'s
 * `viewer_resources` fast path: a live `COUNT(*)` against the narrow,
 * indexed `viewer_resources` table (never the wide write-model `resources`
 * table), with the same filters the id-resolution query applies.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter/sort options.
 * @returns The total number of matching rows.
 */
export async function countViewerResourcesTotal(
	knex: Knex,
	options: ListViewerResourcesOptions,
): Promise<number> {
	const qb = knex('viewer_resources');
	applyViewerResourcesFilters(qb, options);
	const result = await qb.count<{ count: string }[]>({ count: '*' });
	return Number(result[0]?.count ?? 0);
}
