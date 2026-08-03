import type {
	GetViewerIsolatedClusterOptions,
	IsolatedClusterDetail,
	IsolatedClusterMember,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { applyEqualityOrInFilter } from './apply-equality-or-in-filter.js';

/**
 * Applies the `ORDER BY` clauses for cluster-member rows. `status` ordering
 * uses the direction-specific sentinel columns (`status_sort_key` /
 * `status_desc_key`) so null-status members stay strictly orderable in
 * either direction (see `NULL_STATUS_SENTINEL`'s docs); `page_id` is
 * appended as the final key to keep the order total and pagination stable.
 * @param query - A Knex query builder scoped to `viewer_isolated_component_pages`.
 * @param sortBy - The member column to order by; defaults to `url`.
 * @param sortOrder - `asc` (default) or `desc`.
 * @returns The same builder, for chaining.
 */
function applyIsolatedClusterMemberOrder(
	query: Knex.QueryBuilder,
	sortBy: GetViewerIsolatedClusterOptions['sortBy'],
	sortOrder: GetViewerIsolatedClusterOptions['sortOrder'],
): Knex.QueryBuilder {
	switch (sortBy ?? 'url') {
		case 'title': {
			query.orderBy('title_sort_key', sortOrder === 'desc' ? 'desc' : 'asc');
			break;
		}
		case 'status': {
			query.orderBy(sortOrder === 'desc' ? 'status_desc_key' : 'status_sort_key', 'asc');
			break;
		}
		case 'source': {
			query.orderBy('source', sortOrder === 'desc' ? 'desc' : 'asc');
			break;
		}
		default: {
			query.orderBy('url_sort_key', sortOrder === 'desc' ? 'desc' : 'asc');
			break;
		}
	}
	return query.orderBy('page_id', 'asc');
}

/**
 * Fast-path counterpart of `getIsolatedCluster`, backed by
 * `viewer_isolated_components` + `viewer_isolated_component_pages`. Takes
 * {@link GetViewerIsolatedClusterOptions}, not `GetIsolatedClusterOptions`:
 * see that type's docs for why `status`/`source` need a separate,
 * array-capable type here.
 * @param accessor - Archive accessor whose read model is current.
 * @param representativeUrl - Cluster identifier from `listViewerIsolatedClusters`.
 * @param options - Member filters and pagination.
 * @returns Matching cluster detail, or `null` when missing or collapsed to a singleton.
 * @example
 * const cluster = await getViewerIsolatedCluster(
 *   accessor,
 *   'https://example.com/orphan/',
 *   { sortBy: 'status', limit: 50 },
 * );
 * if (cluster) {
 *   console.log(cluster.size, cluster.members.length);
 * }
 */
export async function getViewerIsolatedCluster(
	accessor: ArchiveAccessor,
	representativeUrl: string,
	options: GetViewerIsolatedClusterOptions = {},
): Promise<IsolatedClusterDetail | null> {
	const knex = accessor.getKnex();
	const component = await knex('viewer_isolated_components')
		.where('representative_url', representativeUrl)
		.first('component_id', 'size');

	if (!component || Number(component.size) < 2) {
		return null;
	}

	const baseQuery = knex('viewer_isolated_component_pages').where(
		'component_id',
		Number(component.component_id),
	);
	if (options.urlPattern) {
		baseQuery.where('url', 'like', options.urlPattern);
	}
	applyEqualityOrInFilter(baseQuery, 'status', options.status);
	applyEqualityOrInFilter(baseQuery, 'source', options.source);

	const countResult = (await baseQuery
		.clone()
		.clearSelect()
		.count('page_id as total')) as { total: number }[];
	const total = Number(countResult[0]?.total ?? 0);
	const limit = options.limit ?? total;
	const offset = options.offset ?? 0;

	const members = (await applyIsolatedClusterMemberOrder(
		baseQuery.clone().select('url', 'title', 'status', 'source'),
		options.sortBy,
		options.sortOrder,
	)
		.limit(limit)
		.offset(offset)) as IsolatedClusterMember[];

	return {
		representativeUrl,
		members,
		size: total,
	};
}
