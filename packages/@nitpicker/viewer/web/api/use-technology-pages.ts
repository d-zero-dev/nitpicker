import type { PageListItem } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Fetches the page list for one technology (`/technologies` view's inline
 * drill-down when a row is expanded). Disabled (no request issued) while
 * `technology` is `null`. The endpoint returns a bare array (no pagination
 * envelope) — `listPagesByTechnology`'s natural return shape.
 * @param technology - The technology name to list pages for, or `null` when
 *   nothing is expanded.
 * @returns The TanStack Query result for that technology's page list.
 */
export function useTechnologyPages(technology: string | null) {
	return useQuery({
		queryKey: ['technology-pages', technology],
		queryFn: () =>
			apiGet<PageListItem[]>('/api/technologies/pages', { technology: technology! }),
		enabled: technology !== null,
	});
}
