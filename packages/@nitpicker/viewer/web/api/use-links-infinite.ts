import type { InfiniteQueryOptions } from './infinite-query-options.js';
import type { CursorPaginatedLinkList, LinkEntry } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { PAGE_SIZE } from './page-size.js';

/**
 * Link analysis type. `'broken'` is the only value: there is no
 * `'orphaned'` type (complete singletons live in the **孤立ページ** view
 * (`useIsolatedPagesInfinite`), interconnected orphan groups in the
 * **孤立集合** view (`useIsolatedClustersInfinite`)), and external links
 * have the dedicated `useExternalLinksInfinite` (different response shape —
 * deduplicated by destination with a `referrerCount`, not one row per
 * anchor).
 */
export type LinkType = 'broken';

/** A link analysis row. */
export type LinkRow = LinkEntry;

export interface LinksFilter {
	/** URL pattern applied to the source or destination URL. */
	urlPattern?: string;
	/** Filter by destination HTTP status, or any of several (OR). */
	status?: string | readonly string[];
	/** Sort field. */
	sortBy?: string;
	/** Sort direction. */
	sortOrder?: string;
}

/**
 * Infinite-scrolling broken-link analysis. Fetches `PAGE_SIZE` rows per
 * request and advances via the server-issued `nextCursor` (keyset
 * pagination) rather than a growing `offset` — the same contract
 * `usePagesInfinite` uses for `/api/pages`. `/api/links?type=broken` serves
 * this from the `viewer_anchor_facts` read model when available, falling
 * back to the legacy anchor-scan path (whose `nextCursor` is a plain
 * offset-as-string, per `buildLegacyPagesCursors`) otherwise — this hook
 * never needs to know which backend served a given page.
 * @param type - The link analysis type.
 * @param filter - The active filter/sort state (forms part of the query key).
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
		initialPageParam: null as string | null,
		queryFn: ({ pageParam }) =>
			apiGet<CursorPaginatedLinkList>('/api/links', {
				type,
				...filter,
				limit: PAGE_SIZE,
				cursor: pageParam ?? undefined,
			}),
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled: options?.enabled ?? true,
	});
}
