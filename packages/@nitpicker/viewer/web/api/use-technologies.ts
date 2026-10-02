import type { TechnologyInventoryEntry } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** Response shape of `GET /api/technologies`. */
export interface TechnologiesResult {
	inventory: TechnologyInventoryEntry[];
}

/**
 * Fetches the site-wide technology inventory. Takes no parameters — the
 * endpoint always returns every detected technology in the archive.
 * @returns The TanStack Query result for the technologies overview.
 */
export function useTechnologies() {
	return useQuery({
		queryKey: ['technologies'],
		queryFn: () => apiGet<TechnologiesResult>('/api/technologies'),
	});
}
