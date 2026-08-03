import type { InfiniteQueryOptions } from './infinite-query-options.js';
import type { PagesFilter } from '../types.js';
import type { CursorPaginatedPageList } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { PAGE_SIZE } from './page-size.js';

/**
 * Infinite-scrolling page list. Fetches `PAGE_SIZE` rows per request and
 * advances via the server-issued `nextCursor` (keyset pagination) rather
 * than a growing `offset` — `/api/pages` serves this from the `viewer_pages`
 * read model when available, falling back to the live offset-only path
 * (whose `nextCursor` is a plain offset-as-string, per
 * `buildLivePagesCursors`) otherwise — this hook never needs to know
 * which backend served a given page.
 * @param filter - The active filter/sort state (forms part of the query key).
 * @param options - Optional flags (`enabled`).
 * @returns The TanStack infinite-query result.
 */
export function usePagesInfinite(filter: PagesFilter, options?: InfiniteQueryOptions) {
	return useInfiniteQuery({
		queryKey: ['pages', filter],
		initialPageParam: null as string | null,
		queryFn: ({ pageParam }) =>
			apiGet<CursorPaginatedPageList>('/api/pages', {
				...filter,
				limit: PAGE_SIZE,
				cursor: pageParam ?? undefined,
			}),
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled: options?.enabled ?? true,
	});
}
