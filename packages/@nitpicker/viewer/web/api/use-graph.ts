import type { LinkGraph } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Fetches the internal-page link graph (nodes + edges).
 * @returns The TanStack Query result for the link graph.
 */
export function useGraph() {
	return useQuery({
		queryKey: ['graph'],
		queryFn: () => apiGet<LinkGraph>('/api/graph'),
	});
}
