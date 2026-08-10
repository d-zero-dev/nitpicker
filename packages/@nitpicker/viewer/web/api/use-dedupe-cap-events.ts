import type { DedupeCapEventEntry } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/**
 * Fetches every recorded same-cluster-cap audit row (opt-in
 * `--dedupe-cap`, issue #208) — backs the Crawl Suppression view, and
 * (with `enabled: false` by default callers can opt into) the Pages view's
 * `dedupeCapEventId`-filtered banner, which resolves the id back to its
 * `shape_key` for display.
 * @param options - Optional flags. `enabled` defaults to `true`; pass
 *   `false` to skip the fetch when the caller has no immediate need for it
 *   (e.g. the Pages view only needs this when `dedupeCapEventId` is set).
 * @param options.enabled
 * @returns The TanStack Query result for the dedupe-cap event list.
 */
export function useDedupeCapEvents(options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: ['dedupe-cap-events'],
		queryFn: () =>
			apiGet<{ items: DedupeCapEventEntry[]; total: number }>('/api/dedupe-cap-events'),
		enabled: options?.enabled ?? true,
	});
}
