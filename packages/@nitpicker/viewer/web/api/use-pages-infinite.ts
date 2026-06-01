import type { PagesFilter } from '../types.js';
import type { PaginatedPageList } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

/**
 * Infinite-scrolling page list. Fetches `PAGE_SIZE` rows per request and
 * advances the offset until all matching rows (`total`) are loaded.
 * @param filter - The active filter/sort state (forms part of the query key).
 * @returns The TanStack infinite-query result.
 */
export function usePagesInfinite(filter: PagesFilter) {
	return useInfiniteQuery({
		queryKey: ['pages', filter],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<PaginatedPageList>('/api/pages', {
				...filter,
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
	});
}
