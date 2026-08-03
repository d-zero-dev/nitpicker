import type { InfiniteQueryOptions } from './infinite-query-options.js';
import type { PaginatedExternalLinkList } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

/** Filter state for the external-links view. */
export interface ExternalLinksFilter {
	/** URL pattern applied to the destination URL. */
	urlPattern?: string;
	/** Filter by destination HTTP status, or any of several (OR). */
	status?: string | readonly string[];
	/** Sort field. */
	sortBy?: string;
	/** Sort direction. */
	sortOrder?: string;
}

/**
 * Infinite-scrolling list of unique external destinations (deduplicated by
 * canonical redirect target), each with a referrer count.
 * @param filter - The active filter state.
 * @param options - Optional flags (`enabled`).
 * @returns The TanStack infinite-query result.
 */
export function useExternalLinksInfinite(
	filter: ExternalLinksFilter,
	options?: InfiniteQueryOptions,
) {
	return useInfiniteQuery({
		queryKey: ['external-links', filter],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<PaginatedExternalLinkList>('/api/links', {
				type: 'external',
				...filter,
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
		enabled: options?.enabled ?? true,
	});
}
