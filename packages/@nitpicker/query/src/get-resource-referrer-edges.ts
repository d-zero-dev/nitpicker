import type { Knex } from 'knex';

import { eachSplitted } from '@nitpicker/crawler';

import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/** One `resource_ref_edges` row resolved to its referring page's id and URL. */
export interface ResourceReferrerEdge {
	/** `resource_items.id` of the referenced resource. */
	resourceId: number;
	/** `content_items.id` of the referring page. */
	pageId: number;
	/** The referring page's URL. */
	pageUrl: string;
}

/**
 * Fetches every `resource_ref_edges` row for a batch of resources, resolved
 * to each edge's referring page id and URL.
 *
 * Shared low-level query for the two callers that both need
 * `resource_ref_edges` joined out to a page URL — `getResourceReferrerUrlsByResourceIds`
 * (report-time, groups by `resourceId` only) and `computeResourceGroupRows`
 * (`viewer-build` time, additionally needs `pageId` to union referring pages
 * across a canonical group's constituent raw resources) — so the join shape
 * is kept in one place.
 * @param knex - The archive's Knex instance (or an open transaction).
 * @param resourceIds - `resource_items` ids to fetch referrer edges for.
 * @returns Every matching edge, unordered. A resource with no referrers
 *   contributes no rows.
 * @example
 * const edges = await getResourceReferrerEdges(knex, [1, 2, 3]);
 */
export async function getResourceReferrerEdges(
	knex: Knex,
	resourceIds: readonly number[],
): Promise<ResourceReferrerEdge[]> {
	if (resourceIds.length === 0) {
		return [];
	}
	const result: ResourceReferrerEdge[] = [];
	await eachSplitted(resourceIds, SQLITE_IN_CHUNK, async (chunk) => {
		const rows: ResourceReferrerEdge[] = await knex('resource_ref_edges as rre')
			.join('content_items as ci', 'ci.id', 'rre.page_id')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.whereIn('rre.resource_id', chunk)
			.select(
				'rre.resource_id as resourceId',
				'rre.page_id as pageId',
				'ur.url as pageUrl',
			);
		// Avoid `push(...rows)`: on large real archives this chunk array can
		// be large enough to overflow V8's argument-spread limit even though
		// the underlying data itself fits in memory.
		for (const row of rows) {
			result.push(row);
		}
	});
	return result;
}
