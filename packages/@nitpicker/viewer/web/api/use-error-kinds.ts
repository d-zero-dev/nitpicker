import type { ErrorKindsResult } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Fetches crawl failures classified by cause (DNS, connection, TLS, timeout, …).
 * @returns The TanStack Query result for the error-kinds aggregation.
 */
export function useErrorKinds() {
	return useQuery({
		queryKey: ['error-kinds'],
		queryFn: () => apiGet<ErrorKindsResult>('/api/error-kinds'),
	});
}
