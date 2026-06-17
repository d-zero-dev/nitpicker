import type { UnusedResourceEntry } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Result shape returned by the viewer's `/api/unused-resources` endpoint.
 * Mirrors `listUnusedResources` from `@nitpicker/query`.
 */
export interface UnusedResourcesResult {
	items: UnusedResourceEntry[];
	total: number;
}

/**
 * Fetches internal sub-resources with zero referrers — candidates for
 * deletion from the server.
 * @param limit - Maximum rows to return.
 * @param offset - Number of rows to skip from the start.
 * @returns The TanStack Query result for the unused resources list.
 */
export function useUnusedResources(limit = 100, offset = 0) {
	return useQuery({
		queryKey: ['unused-resources', limit, offset],
		queryFn: () =>
			apiGet<UnusedResourcesResult>(
				`/api/unused-resources?limit=${limit}&offset=${offset}`,
			),
	});
}
