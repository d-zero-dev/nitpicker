import type { ResourceFileCounts } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { eachSplitted } from '@nitpicker/crawler';

import { SQLITE_IN_CHUNK } from '../sqlite-in-chunk.js';

/**
 * Fetches per-page sub-resource tallies for a batch of pages, from
 * `resource_ref_edges` joined to `resource_items`.
 *
 * The batch shape mirrors `getOutboundLinkFactsByPageIds`: one grouped query
 * per `streamPageListRows` chunk instead of two aggregates per page, so a
 * report's "resource files" column costs a fixed number of round trips
 * regardless of page count.
 *
 * Reads the write-model tables directly (no read-model dependency) — these
 * are the same tables `streamAllResourcesRaw` reads, and the per-page
 * aggregation is a plain `GROUP BY` over the `page_id`-indexed edge table
 * (`idx_resource_ref_edges_page`), so there is nothing to precompute into
 * `viewer_*` for it.
 * @param accessor - The archive accessor to query.
 * @param pageIds - `content_items` ids to tally resources for (a
 *   `streamPageListRows` chunk, typically).
 * @returns Map from `page_id` to its {@link ResourceFileCounts}. A page that
 *   references no resource at all has no entry — callers should fall back to
 *   `{ total: 0, exists: 0 }`.
 * @example
 * const counts = await getResourceFileCountsByPageIds(accessor, [1, 2, 3]);
 * const forPage1 = counts.get(1) ?? { total: 0, exists: 0 };
 */
export async function getResourceFileCountsByPageIds(
	accessor: ArchiveAccessor,
	pageIds: readonly number[],
): Promise<Map<number, ResourceFileCounts>> {
	if (pageIds.length === 0) {
		return new Map();
	}
	const knex = accessor.getKnex();

	const result = new Map<number, ResourceFileCounts>();
	await eachSplitted(pageIds, SQLITE_IN_CHUNK, async (chunk) => {
		const rows: {
			pageId: number;
			total: string | number;
			existing: string | number;
		}[] = await knex('resource_ref_edges as rre')
			// Inner join, not LEFT: `resource_ref_edges.resource_id` is a
			// non-nullable FK to `resource_items(id)`, so no edge can lose its
			// resource row and the join drops nothing.
			.join('resource_items as ri', 'ri.id', 'rre.resource_id')
			.whereIn('rre.page_id', chunk)
			.groupBy('rre.page_id')
			.select(
				'rre.page_id as pageId',
				// `count(*)` over the edge rows, deliberately not
				// `sum(rre.count)`: the tally is "how many distinct files does
				// this page pull in", and the edge table's
				// `(resource_id, page_id)` primary key already makes each row one
				// distinct resource (0.13 writes `count = 1` on every row anyway
				// — see `streamResourceReferrerEdges`' docs).
				knex.raw('count(*) as "total"'),
				// A null status (never fetched, or the fetch failed before a
				// response) fails the range and lands in the `else` arm, so it
				// counts as missing rather than as unknown.
				knex.raw(
					'sum(case when "ri"."status" >= 200 and "ri"."status" <= 399 then 1 else 0 end) as "existing"',
				),
			);

		for (const row of rows) {
			result.set(row.pageId, {
				total: Number(row.total),
				exists: Number(row.existing),
			});
		}
	});
	return result;
}
