import type { PaginatedPageLinkList } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

/** Filter state for the page-links view. */
export interface PageLinksFilter {
	/** Filter by external/internal. */
	isExternal?: boolean;
	/** URL pattern (SQL LIKE). */
	urlPattern?: string;
}

/**
 * Infinite-scrolling per-page network list (google-sheets "Links" equivalent).
 * @param filter - The active filter state.
 * @returns The TanStack infinite-query result.
 */
export function usePageLinksInfinite(filter: PageLinksFilter) {
	return useInfiniteQuery({
		queryKey: ['page-links', filter],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<PaginatedPageLinkList>('/api/page-links', {
				...filter,
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
	});
}
