import type { InboundLinkList } from '@nitpicker/query';
import type { QueryKey } from '@tanstack/react-query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Response shape `/api/pages/inbound-links` returns instead of an
 * {@link InboundLinkList} when the viewer read model cannot serve the
 * request — currently only reachable in stub mode (a live crawl), where
 * `viewer_anchor_facts` can never exist. Mirrors
 * `register-inbound-links-route.ts`'s `InboundLinksUnavailable` on the wire;
 * declared independently here rather than imported, since `web/` never
 * imports types from the backend's `src/` — the two are built by separate
 * toolchains (Vite vs `tsc`) despite sharing a package.
 */
export interface InboundLinksUnavailable {
	/** Always `false` — the discriminant this hook's callers check for. */
	available: false;
}

/** The union `useInboundLinks`/`useInboundLinksInfinite` callers must narrow before reading `items`/`total`. */
export type InboundLinksResponse = InboundLinkList | InboundLinksUnavailable;

/**
 * Fetches one bounded window of a target page's inbound links — MPA-mode
 * paging (`limit`/`offset`) or a count-only read (`limit: 0`, e.g. Page
 * Detail's referrer count).
 *
 * Retry is disabled (`retry: false`): a thrown error here means the viewer
 * read model is missing or stale (see `requireViewerReadModel`), which does
 * not resolve itself between retries — surfacing it immediately gives the
 * `viewer-build` guidance to the user without a multi-retry delay.
 * @param url - The target page's URL (query disabled when empty).
 * @param params - `limit`/`offset` for this window.
 * @param params.limit
 * @param params.offset
 * @param queryKey - The TanStack Query cache key. Must include every value
 *   that influences the response (`url`, `limit`, `offset`) so two requests
 *   never collapse onto the same cache entry.
 * @param options - Optional flags (`enabled`).
 * @param options.enabled
 * @returns The TanStack Query result — narrow on `'available' in data` before
 *   reading `items`/`total`.
 */
export function useInboundLinks(
	url: string,
	params: { limit?: number; offset?: number },
	queryKey: QueryKey,
	options?: { enabled?: boolean },
) {
	return useQuery<InboundLinksResponse>({
		queryKey,
		queryFn: () =>
			apiGet<InboundLinksResponse>('/api/pages/inbound-links', { url, ...params }),
		enabled: (options?.enabled ?? true) && url !== '',
		retry: false,
		placeholderData: (previous) => previous,
	});
}
