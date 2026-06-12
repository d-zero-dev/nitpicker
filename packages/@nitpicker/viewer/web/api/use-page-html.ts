import type { PageHtmlResult } from '../types.js';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Fetches the stored HTML snapshot for a page.
 * @param url - The page URL (query disabled when empty).
 * @returns The TanStack Query result for the HTML snapshot.
 */
export function usePageHtml(url: string) {
	return useQuery({
		queryKey: ['page-html', url],
		queryFn: () => apiGet<PageHtmlResult>('/api/pages/html', { url }),
		enabled: url !== '',
	});
}
