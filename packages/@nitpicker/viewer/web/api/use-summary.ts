import type { SummaryResult } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Fetches site-wide summary statistics.
 * @returns The TanStack Query result for the summary.
 */
export function useSummary() {
	return useQuery({
		queryKey: ['summary'],
		queryFn: () => apiGet<SummaryResult>('/api/summary'),
	});
}
