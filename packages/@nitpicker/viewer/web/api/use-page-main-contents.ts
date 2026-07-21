import type { PageMainContents } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Fetches the main-content region's aggregate counts and all 8 child-entity
 * details (headings, images, tables, buttons, iframes, videos, audios,
 * canvases) for a single page.
 * @param url - The page URL (query disabled when empty).
 * @returns The TanStack Query result for the page's main contents.
 */
export function usePageMainContents(url: string) {
	return useQuery({
		queryKey: ['page-main-contents', url],
		queryFn: () => apiGet<PageMainContents>('/api/pages/main-contents', { url }),
		enabled: url !== '',
	});
}
