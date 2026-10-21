import type { Knex } from 'knex';

import { eachSplitted } from '@nitpicker/archive/utils/array/each-splitted';

import { buildResourceReferrerEdgeQuery } from './build-resource-referrer-edge-query.js';
import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/** One referrer edge: a resource, and the id of a page that references it. */
export interface ResourceReferrerPageEdge {
	/** `resource_items.id` of the referenced resource. */
	resourceId: number;
	/** `content_items.id` of the referring page. */
	pageId: number;
}

/**
 * The (resource, referring page) pairs of `resource_ref_edges` for a set of
 * resources — the same rows as `getResourceReferrerEdges` (both build
 * their query with `buildResourceReferrerEdgeQuery`, so an edge whose page has
 * no `content_items` / `url_refs` row is dropped the same way), but without
 * each page's URL.
 *
 * Why a separate function: a caller that only counts distinct pages (or looks
 * a few URLs up afterwards) would otherwise have SQLite read and JS allocate
 * a URL string for every edge — hundreds of thousands per chunk for a
 * stylesheet every page references — only to throw nearly all of them away.
 * @param knex - A Knex instance or open transaction.
 * @param resourceIds - `resource_items.id` values to look up.
 * @returns One entry per edge, in no defined order. Empty for an empty list.
 * @example
 * const edges = await getResourceReferrerPageEdges(trx, [stylesheetId]);
 * // [{ resourceId: stylesheetId, pageId: 12 }, { resourceId: stylesheetId, pageId: 40 }]
 */
export async function getResourceReferrerPageEdges(
	knex: Knex,
	resourceIds: readonly number[],
): Promise<ResourceReferrerPageEdge[]> {
	if (resourceIds.length === 0) {
		return [];
	}
	const result: ResourceReferrerPageEdge[] = [];
	await eachSplitted(resourceIds, SQLITE_IN_CHUNK, async (chunk) => {
		const rows: ResourceReferrerPageEdge[] = await buildResourceReferrerEdgeQuery(
			knex,
			chunk,
		).select('rre.resource_id as resourceId', 'rre.page_id as pageId');
		// Avoid `push(...rows)`: the same V8 argument-spread limit as
		// `getResourceReferrerEdges`.
		for (const row of rows) {
			result.push(row);
		}
	});
	return result;
}
