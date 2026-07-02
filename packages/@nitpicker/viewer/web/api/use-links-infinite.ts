import type { InfiniteQueryOptions } from './infinite-query-options.js';
import type { LinkEntry } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

/**
 * Link analysis type. `'orphaned'` was retired: complete singletons live in
 * the **孤立ページ** view (`useIsolatedPagesInfinite`) and interconnected
 * orphan groups live in the **孤立集合** view (`useIsolatedClustersInfinite`).
 */
export type LinkType = 'broken' | 'external';

/** A link analysis row. */
export type LinkRow = LinkEntry;

export interface LinksFilter {
	/** URL pattern applied to source or destination URL. */
	urlPattern?: string;
	/** Filter by destination HTTP status. */
	status?: number;
	/** Sort field. */
	sortBy?: string;
	/** Sort direction. */
	sortOrder?: string;
}

/** Paginated link analysis response shape. */
interface LinksPage {
	/** Rows for this page. */
	items: LinkRow[];
	/** Total matching rows. */
	total: number;
}

/**
 * Infinite-scrolling link analysis (broken / external).
 * @param type - The link analysis type.
 * @param filter
 * @param options - Optional flags (`enabled`).
 * @returns The TanStack infinite-query result.
 */
export function useLinksInfinite(
	type: LinkType,
	filter: LinksFilter,
	options?: InfiniteQueryOptions,
) {
	return useInfiniteQuery({
		queryKey: ['links', type, filter],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<LinksPage>('/api/links', {
				type,
				...filter,
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
		enabled: options?.enabled ?? true,
	});
}
