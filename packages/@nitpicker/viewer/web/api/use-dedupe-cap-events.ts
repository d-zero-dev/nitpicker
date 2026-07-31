import type { DedupeCapEventEntry } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Fetches every recorded same-cluster-cap audit row (opt-in
 * `--dedupe-cap`, issue #208) — backs the Duplicate Clusters view's "crawl
 * confirmed N same-cluster traps" notice.
 * @returns The TanStack Query result for the dedupe-cap event list.
 */
export function useDedupeCapEvents() {
	return useQuery({
		queryKey: ['dedupe-cap-events'],
		queryFn: () =>
			apiGet<{ items: DedupeCapEventEntry[]; total: number }>('/api/dedupe-cap-events'),
	});
}
