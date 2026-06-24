import type { IsolatedPageEntry } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

/**
 * Paginated response shape from `GET /api/isolated-pages` — duplicated
 * client-side so the React component can type the response without
 * importing the knex-bound query module into the bundle.
 */
export interface IsolatedPagesPage {
	/** Singleton inventory-* page rows for this page of results. */
	items: IsolatedPageEntry[];
	/** Total number of singletons across the whole archive. */
	total: number;
}

/**
 * Infinite-scrolling **完全孤立** page list. Fetches `PAGE_SIZE` rows per
 * request and advances the offset until all matching rows (`total`) are
 * loaded — replaces the previous fixed-100-row {@link useIsolatedPages}
 * hook so the rendered list count matches the displayed total at every
 * scroll position.
 * @returns The TanStack infinite-query result for singleton inventory pages.
 */
export function useIsolatedPagesInfinite() {
	return useInfiniteQuery({
		queryKey: ['isolated-pages-infinite'],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<IsolatedPagesPage>('/api/isolated-pages', {
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
	});
}
