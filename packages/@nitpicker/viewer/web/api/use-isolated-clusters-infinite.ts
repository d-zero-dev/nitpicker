import type { InfiniteQueryOptions } from './infinite-query-options.js';
import type { IsolatedClusterSummary } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

export interface IsolatedClustersFilter {
	/** URL pattern applied to representative URLs. */
	urlPattern?: string;
	/** Filter by representative member status. */
	status?: number;
	/** Sort field. */
	sortBy?: string;
	/** Sort direction. */
	sortOrder?: string;
}

/**
 * Paginated response shape from `GET /api/isolated-clusters` — duplicated
 * client-side so the React component can type the response without
 * importing the knex-bound query module.
 */
export interface IsolatedClustersPage {
	/** Cluster summaries (size ≥ 2) for this page of results, sorted by size DESC. */
	items: IsolatedClusterSummary[];
	/** Total number of clusters across the whole archive. */
	total: number;
}

/**
 * Infinite-scrolling **孤立集合** cluster summary list. Each row identifies
 * a cluster by its `representativeUrl`; the viewer drills into a specific
 * cluster via {@link import('./use-isolated-cluster.js').useIsolatedCluster}.
 * @param filter - The active filter state.
 * @param options - Optional flags (`enabled`).
 * @returns The TanStack infinite-query result for cluster summaries.
 */
export function useIsolatedClustersInfinite(
	filter: IsolatedClustersFilter,
	options?: InfiniteQueryOptions,
) {
	return useInfiniteQuery({
		queryKey: ['isolated-clusters-infinite', filter],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<IsolatedClustersPage>('/api/isolated-clusters', {
				...filter,
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
		enabled: options?.enabled ?? true,
	});
}
