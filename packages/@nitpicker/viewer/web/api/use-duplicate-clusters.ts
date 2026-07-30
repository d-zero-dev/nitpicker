import type { DuplicateBodyClusterEntry } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** Parameters accepted by {@link useDuplicateClusters}. */
export interface UseDuplicateClustersParams {
	/** Minimum cluster size to include. Server defaults to 10 when omitted. */
	minCount?: number;
}

/**
 * Fetches same-`body_hash` clusters filtered and ranked for "is this a
 * self-generating crawl trap" (issue #208) — see `@nitpicker/query`'s
 * `listDuplicateBodyClusters` for the filtering/ranking rules.
 * @param params - See {@link UseDuplicateClustersParams}.
 * @returns The TanStack Query result for the duplicate cluster list.
 */
export function useDuplicateClusters(params: UseDuplicateClustersParams = {}) {
	return useQuery({
		queryKey: ['duplicate-clusters', params.minCount],
		queryFn: () =>
			apiGet<DuplicateBodyClusterEntry[]>('/api/duplicate-clusters', {
				minCount: params.minCount,
			}),
	});
}
