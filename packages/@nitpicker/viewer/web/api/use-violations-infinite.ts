import type { InfiniteQueryOptions } from './infinite-query-options.js';
import type { ViolationEntry } from '../types.js';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

/** Paginated violations response shape. */
interface ViolationsPage {
	/** Violation entries for this page. */
	items: ViolationEntry[];
	/** Total matching violations. */
	total: number;
}

/** Filter state for the violations view. */
export interface ViolationsFilter {
	/** Filter by validator name. */
	validator?: string;
	/** Filter by severity. */
	severity?: string;
	/** Filter by rule ID. */
	rule?: string;
}

/**
 * Infinite-scrolling analysis violations list.
 * @param filter - The active filter state.
 * @param options - Optional flags (`enabled`).
 * @returns The TanStack infinite-query result.
 */
export function useViolationsInfinite(
	filter: ViolationsFilter,
	options?: InfiniteQueryOptions,
) {
	return useInfiniteQuery({
		queryKey: ['violations', filter],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<ViolationsPage>('/api/violations', {
				...filter,
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
		enabled: options?.enabled ?? true,
	});
}
