import type { IsolatedPageEntry } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Result shape returned by the viewer's `/api/isolated-pages` endpoint.
 * Mirrors `listIsolatedPages` from `@nitpicker/query` — duplicated here
 * only so the React component can type the response without pulling
 * the knex-bound query module client-side.
 */
export interface IsolatedPagesResult {
	items: IsolatedPageEntry[];
	total: number;
}

/**
 * Fetches HTML pages with no inbound anchors (orphan LPs). Limit and offset
 * pass through to {@link import('@nitpicker/query').listIsolatedPages}.
 * @param limit - Maximum number of pages to return.
 * @param offset - Number of pages to skip from the start.
 * @returns The TanStack Query result for the isolated pages list.
 */
export function useIsolatedPages(limit = 100, offset = 0) {
	return useQuery({
		queryKey: ['isolated-pages', limit, offset],
		queryFn: () =>
			apiGet<IsolatedPagesResult>(`/api/isolated-pages?limit=${limit}&offset=${offset}`),
	});
}
