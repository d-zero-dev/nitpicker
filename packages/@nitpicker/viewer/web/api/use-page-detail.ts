import type { PageDetail } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Fetches full detail for a single page.
 * @param url - The page URL (query disabled when empty).
 * @returns The TanStack Query result for the page detail.
 */
export function usePageDetail(url: string) {
	return useQuery({
		queryKey: ['page-detail', url],
		queryFn: () => apiGet<PageDetail>('/api/pages/detail', { url }),
		enabled: url !== '',
	});
}
