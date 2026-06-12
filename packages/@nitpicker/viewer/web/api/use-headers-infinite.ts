import type { PaginatedHeaderCheckList } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

/**
 * Infinite-scrolling security-header check list.
 * @param missingOnly - When true, only pages missing at least one header.
 * @returns The TanStack infinite-query result.
 */
export function useHeadersInfinite(missingOnly: boolean) {
	return useInfiniteQuery({
		queryKey: ['headers', missingOnly],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<PaginatedHeaderCheckList>('/api/headers', {
				missingOnly,
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
	});
}
