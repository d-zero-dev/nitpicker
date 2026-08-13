import type { PageTechnologyEntry } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** Response shape of `GET /api/pages/technologies?url=`. */
export interface PageTechnologiesResult {
	technologies: PageTechnologyEntry[];
}

/**
 * Fetches every detected technology for a single page, confidence
 * descending, with the raw signals (evidence) behind each one — the Page
 * Detail view's technologies star chart and its per-row evidence expansion.
 * @param url - The page URL (query disabled when empty).
 * @returns The TanStack Query result for the page's technologies.
 */
export function usePageTechnologies(url: string) {
	return useQuery({
		queryKey: ['page-technologies', url],
		queryFn: () => apiGet<PageTechnologiesResult>('/api/pages/technologies', { url }),
		enabled: url !== '',
	});
}
