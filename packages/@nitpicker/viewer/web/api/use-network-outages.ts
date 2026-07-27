import type { NetworkOutageEntry } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** Response shape of `GET /api/network-outages`. */
export interface NetworkOutagesResult {
	items: NetworkOutageEntry[];
	total: number;
}

/**
 * Fetches every recorded operator-network outage for the opened archive.
 * Backs the Summary view's "N failures may clear after `crawl
 * --retry-failed`" notice.
 * @returns The TanStack Query result for the outage list.
 */
export function useNetworkOutages() {
	return useQuery({
		queryKey: ['network-outages'],
		queryFn: () => apiGet<NetworkOutagesResult>('/api/network-outages'),
	});
}
