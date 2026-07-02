import type { QueryKey } from '@tanstack/react-query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** A query-parameter value accepted by {@link usePagedQuery}. */
type ParamValue = string | number | boolean | undefined;

/** Options for {@link usePagedQuery}. */
export interface UsePagedQueryOptions {
	/**
	 * Suppresses the request when `false`. Used by list views to keep the MPA
	 * query idle while the user is in virtual mode (the corresponding
	 * `useInfiniteQuery` runs in its place).
	 */
	enabled?: boolean;
	/**
	 * When `true` (default), the previous page's data stays visible while the
	 * next page is fetched — the user sees the table without flashing back to
	 * a skeleton on every Prev/Next click.
	 */
	keepPreviousData?: boolean;
}

/** The minimal paginated payload shape expected from `/api/*` list endpoints. */
export interface PagedResponse<T, TFacets = unknown> {
	/** The rows on the requested page. */
	items: T[];
	/** Total matching rows on the server. */
	total: number;
	/** Optional dynamic enum candidates for table filters. */
	facets?: TFacets;
}

/**
 * The shared MPA list-fetching hook.
 *
 * Wraps `useQuery` around {@link apiGet} so every list view's MPA mode has a
 * single hook to call with no per-view boilerplate. The corresponding
 * virtual-mode hook is `use-*-infinite.ts` and stays untouched — the two
 * coexist so a view file's MPA / virtual branches each call exactly one of
 * them based on the user's mode preference.
 * @param path - The endpoint to fetch (e.g. `/api/pages`).
 * @param params - The query parameters (filter values plus `limit` / `offset`).
 *   `undefined` values are stripped by {@link apiGet}.
 * @param queryKey - The TanStack Query cache key. Must include every value
 *   that influences the response (filter, page, page size) so two requests
 *   never collapse onto the same cache entry.
 * @param options - Optional flags (`enabled`, `keepPreviousData`).
 * @returns The TanStack Query result for the page.
 */
export function usePagedQuery<T, TFacets = unknown>(
	path: string,
	params: Record<string, ParamValue>,
	queryKey: QueryKey,
	options?: UsePagedQueryOptions,
) {
	return useQuery<PagedResponse<T, TFacets>>({
		queryKey,
		queryFn: () => apiGet<PagedResponse<T, TFacets>>(path, params),
		enabled: options?.enabled ?? true,
		placeholderData: (previous) =>
			(options?.keepPreviousData ?? true) ? previous : undefined,
	});
}
