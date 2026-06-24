import type { IsolatedClusterDetail } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Fetches the full member list of one **孤立集合** cluster from
 * `GET /api/isolated-clusters/:representativeUrl`.
 *
 * When the backend responds 404, `apiGet` throws, so the hook enters the
 * error state (`isError === true`, `data === undefined`). Callers should
 * branch on `isError` — NOT on `data === null` — to render the "cluster
 * collapsed" UX (e.g. a follow-up crawl demoted one of the cluster's
 * inventory-* members to `'crawled'`, breaking the connected component).
 * React Query's `enabled` flag suppresses the request when
 * `representativeUrl` is empty so the master-detail UI can switch the
 * cluster slot without firing a pointless network call.
 *
 * Retry is disabled (`retry: false`) so a true 404 surfaces immediately
 * rather than after three retries — the cluster does not come back into
 * existence on its own, so retrying would just delay the UI feedback.
 * @param representativeUrl - The cluster identifier (from `useIsolatedClustersInfinite`).
 * @returns The TanStack Query result for the cluster detail; check `isError` for the 404 / collapsed case.
 */
export function useIsolatedCluster(representativeUrl: string) {
	return useQuery({
		queryKey: ['isolated-cluster', representativeUrl],
		enabled: representativeUrl.length > 0,
		retry: false,
		queryFn: async () => {
			const path = `/api/isolated-clusters/${encodeURIComponent(representativeUrl)}`;
			return apiGet<IsolatedClusterDetail>(path);
		},
	});
}
