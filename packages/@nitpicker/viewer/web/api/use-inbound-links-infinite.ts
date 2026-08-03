import type { InfiniteQueryOptions } from './infinite-query-options.js';
import type { InboundLinksResponse } from './use-inbound-links.js';
import type { InboundLinkEntry } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { PAGE_SIZE } from './page-size.js';

/** One inbound-link row, as rendered by the inbound-links view. */
export type InboundLinkRow = InboundLinkEntry;

/**
 * Infinite-scrolling inbound-link listing for one target page. Fetches
 * `PAGE_SIZE` rows per request and advances via the server-issued
 * `nextCursor` (keyset pagination) — `/api/pages/inbound-links` has no
 * offset-vs-cursor branch to hide from this hook (unlike
 * `useLinksInfinite`'s live fallback): it reads `viewer_anchor_facts`
 * exclusively, so the cursor shape never changes between pages.
 *
 * In stub mode the endpoint responds `{ available: false }` with no
 * `nextCursor` — `getNextPageParam` naturally reads that as "no next page"
 * and the fetch stops after one page; the view checks `'available' in page`
 * to render the stub-mode notice instead of an empty table.
 *
 * Retry is disabled (`retry: false`), matching `useInboundLinks`: a thrown
 * error means the viewer read model is missing or stale, which does not
 * resolve itself between retries.
 * @param url - The target page's URL.
 * @param options - Optional flags (`enabled`).
 * @returns The TanStack infinite-query result.
 */
export function useInboundLinksInfinite(url: string, options?: InfiniteQueryOptions) {
	return useInfiniteQuery({
		queryKey: ['inbound-links', url],
		initialPageParam: null as string | null,
		queryFn: ({ pageParam }) =>
			apiGet<InboundLinksResponse>('/api/pages/inbound-links', {
				url,
				limit: PAGE_SIZE,
				cursor: pageParam ?? undefined,
			}),
		getNextPageParam: (lastPage) =>
			('available' in lastPage ? undefined : lastPage.nextCursor) ?? undefined,
		enabled: (options?.enabled ?? true) && url !== '',
		retry: false,
	});
}
