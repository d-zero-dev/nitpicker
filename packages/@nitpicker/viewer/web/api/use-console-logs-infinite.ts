import type { InfiniteQueryOptions } from './infinite-query-options.js';
import type { ConsoleLogSummaryEntry } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

/** Paginated console-logs response shape. */
interface ConsoleLogsPage {
	/** Aggregated console log entries for this page. */
	items: ConsoleLogSummaryEntry[];
	/** Total matching distinct entries. */
	total: number;
}

/** Filter state for the Console Logs view. */
export interface ConsoleLogsFilter {
	/** Filter to one console message type (or `'pageerror'`). */
	type?: string;
	/** Field to sort by. */
	sortBy?: string;
	/** Sort direction. */
	sortOrder?: string;
}

/**
 * Infinite-scrolling console-logs list.
 * @param filter - The active filter state.
 * @param options - Optional flags (`enabled`).
 * @returns The TanStack infinite-query result.
 */
export function useConsoleLogsInfinite(
	filter: ConsoleLogsFilter,
	options?: InfiniteQueryOptions,
) {
	return useInfiniteQuery({
		queryKey: ['console-logs', filter],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<ConsoleLogsPage>('/api/console-logs', {
				...filter,
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
		enabled: options?.enabled ?? true,
	});
}
