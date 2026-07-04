import type { ListViewerUnusedResourcesOptions } from './types.js';
import type { Knex } from 'knex';

import { applyViewerUnusedResourcesFilters } from './apply-viewer-unused-resources-filters.js';

/**
 * Resolves the total matching row count for `/api/unused-resources`'s
 * `viewer_resources` fast path: a live `COUNT(*)` against the narrow,
 * indexed `viewer_resources` table (never an anti-join over the wide
 * write-model `resources`/`resources-referrers` tables), with the same
 * filters the id-resolution query applies.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter/sort options.
 * @returns The total number of matching rows.
 */
export async function countViewerUnusedResourcesTotal(
	knex: Knex,
	options: ListViewerUnusedResourcesOptions,
): Promise<number> {
	const qb = knex('viewer_resources');
	applyViewerUnusedResourcesFilters(qb, options);
	const result = await qb.count<{ count: string }[]>({ count: '*' });
	return Number(result[0]?.count ?? 0);
}
