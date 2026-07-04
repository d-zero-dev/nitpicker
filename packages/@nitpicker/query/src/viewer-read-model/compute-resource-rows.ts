import type { ResourceInsertRows } from './types.js';
import type { Knex } from 'knex';

import { NULL_STATUS_SENTINEL } from './null-status-sentinel.js';

/**
 * Computes insert rows for both resource read-model tables
 * (`viewer_resources`, `viewer_resource_stats`) from a single `resources`
 * scan — the only `resources`/`resources-referrers` scan the read-model
 * build performs, mirroring `computeAnchorFactRows`'s "one scan, multiple
 * tables" pattern.
 *
 * `referrer_count` is `COUNT("resources-referrers"."id")` rather than
 * `COUNT(*)`: the `LEFT JOIN` produces one null-referrer row per
 * zero-referrer resource, and `COUNT(*)` would count that phantom row as 1
 * instead of 0.
 *
 * `is_unused` is lifted verbatim from `listUnusedResources`'s definition
 * (external resources are never "unused" candidates, regardless of referrer
 * count — see that function's docs).
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests).
 * @returns Insert rows for `viewer_resources` and `viewer_resource_stats`.
 */
export async function computeResourceInsertRows(trx: Knex): Promise<ResourceInsertRows> {
	const rows: {
		id: number;
		isExternal: 0 | 1;
		status: number | null;
		source: string;
		url: string;
		referrerCount: string | number;
	}[] = await trx('resources')
		.leftJoin(
			'resources-referrers',
			'resources.id',
			'=',
			'resources-referrers.resourceId',
		)
		.groupBy('resources.id')
		.select(
			'resources.id as id',
			'resources.isExternal as isExternal',
			'resources.status as status',
			'resources.source as source',
			'resources.url as url',
		)
		.count('resources-referrers.id as referrerCount');

	const resources = rows.map((row) => {
		const isExternal = row.isExternal ? 1 : 0;
		const referrerCount = Number(row.referrerCount);
		const statusSortKey = row.status ?? NULL_STATUS_SENTINEL;
		return {
			resource_id: row.id,
			is_external: isExternal,
			status: row.status,
			status_sort_key: statusSortKey,
			status_desc_key: -statusSortKey,
			source: row.source as ResourceInsertRows['resources'][number]['source'],
			is_unused: isExternal === 0 && referrerCount === 0 ? 1 : 0,
			url_sort_key: row.url,
		};
	});

	const stats = rows.map((row) => ({
		resource_id: row.id,
		referrer_count: Number(row.referrerCount),
	}));

	return { resources, stats };
}
