import type { IsolatedClusterSummary, ListIsolatedClustersOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

/**
 * Applies the `ORDER BY` clauses for cluster-summary rows. Descending
 * `size` / `representativeStatus` ordering goes through the precomputed
 * negated-key columns (`size_desc_key`, `representative_status_desc_key`)
 * with a plain `asc` scan, so both directions read the same-shaped index and
 * null-status rows stay strictly orderable (see `NULL_STATUS_SENTINEL`'s
 * docs); `representative_url_sort_key` + `component_id` are appended as
 * final keys to keep the order total and pagination stable.
 * @param query - A Knex query builder scoped to `viewer_isolated_components`.
 * @param sortBy - The summary column to order by; defaults to `size`.
 * @param sortOrder - `asc` or `desc`; defaults to `size` descending.
 * @returns The same builder, for chaining.
 */
function applyIsolatedClusterOrder(
	query: Knex.QueryBuilder,
	sortBy: ListIsolatedClustersOptions['sortBy'],
	sortOrder: ListIsolatedClustersOptions['sortOrder'],
): Knex.QueryBuilder {
	switch (sortBy ?? 'size') {
		case 'representativeTitle': {
			query.orderBy(
				'representative_title_sort_key',
				sortOrder === 'desc' ? 'desc' : 'asc',
			);
			break;
		}
		case 'representativeStatus': {
			query.orderBy(
				sortOrder === 'desc'
					? 'representative_status_desc_key'
					: 'representative_status_sort_key',
				'asc',
			);
			break;
		}
		case 'representativeUrl': {
			query.orderBy('representative_url_sort_key', sortOrder === 'desc' ? 'desc' : 'asc');
			break;
		}
		default: {
			query.orderBy(sortOrder === 'asc' ? 'size' : 'size_desc_key', 'asc');
			break;
		}
	}
	return query
		.orderBy('representative_url_sort_key', 'asc')
		.orderBy('component_id', 'asc');
}

/**
 * Fast-path counterpart of `listIsolatedClusters`, backed by the
 * `viewer_isolated_components` read model.
 * @param accessor - Archive accessor whose read model is current.
 * @param options - Filters and offset pagination.
 * @returns Cluster summaries with the same public shape as `listIsolatedClusters`.
 * @example
 * const { items, total } = await listViewerIsolatedClusters(accessor, {
 *   sortBy: 'size',
 *   limit: 50,
 * });
 */
export async function listViewerIsolatedClusters(
	accessor: ArchiveAccessor,
	options: ListIsolatedClustersOptions = {},
): Promise<{ items: IsolatedClusterSummary[]; total: number }> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	const baseQuery = knex('viewer_isolated_components').where('size', '>=', 2);
	if (options.urlPattern) {
		baseQuery.where('representative_url', 'like', options.urlPattern);
	}
	if (options.status != null) {
		baseQuery.where('representative_status', options.status);
	}

	const countResult = (await baseQuery
		.clone()
		.clearSelect()
		.count('component_id as total')) as { total: number }[];
	const total = Number(countResult[0]?.total ?? 0);

	const rows = (await applyIsolatedClusterOrder(
		baseQuery
			.clone()
			.select(
				'representative_url as representativeUrl',
				'representative_title as representativeTitle',
				'representative_status as representativeStatus',
				'size',
			),
		options.sortBy,
		options.sortOrder,
	)
		.limit(limit)
		.offset(offset)) as IsolatedClusterSummary[];

	return { items: rows, total };
}
