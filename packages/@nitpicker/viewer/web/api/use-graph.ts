import type { LinkGraph } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { apiGet } from './api-client.js';
import { getGraphQueryParams } from './get-graph-query-params.js';

/**
 * Fetches the internal-page link graph (nodes + edges).
 *
 * Forwards `?limit=` from the current URL to the API via
 * {@link getGraphQueryParams} so an operator can override the server-side
 * default cap without editing the URL by hand. `?limit=0` uncaps the graph
 * (accepting the V8 string-limit risk), any positive integer sets a custom
 * cap, and omitting the parameter falls back to the API's default.
 * @returns The TanStack Query result for the link graph.
 */
export function useGraph() {
	const [searchParams] = useSearchParams();
	const params = getGraphQueryParams(searchParams);
	return useQuery({
		queryKey: ['graph', params.limit],
		queryFn: () => apiGet<LinkGraph>('/api/graph', params),
	});
}
