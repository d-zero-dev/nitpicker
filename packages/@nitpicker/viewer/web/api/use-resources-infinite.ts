import type { InfiniteQueryOptions } from './infinite-query-options.js';
import type { PaginatedResourceList } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

/** Filter state for the resources view. */
export interface ResourcesFilter {
	/** URL pattern (SQL LIKE). */
	urlPattern?: string;
	/** Filter by HTTP status, or any of several (OR). */
	status?: string | readonly string[];
	/** Filter by content-type prefix. */
	contentType?: string;
	/** Filter by external/internal, or any of several (OR). */
	isExternal?: string | readonly string[];
	/** Sort field. */
	sortBy?: string;
	/** Sort direction. */
	sortOrder?: string;
}

/**
 * Infinite-scrolling resource list.
 * @param filter - The active filter state.
 * @param options - Optional flags (`enabled`).
 * @returns The TanStack infinite-query result.
 */
export function useResourcesInfinite(
	filter: ResourcesFilter,
	options?: InfiniteQueryOptions,
) {
	return useInfiniteQuery({
		queryKey: ['resources', filter],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<PaginatedResourceList>('/api/resources', {
				...filter,
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
		enabled: options?.enabled ?? true,
	});
}
