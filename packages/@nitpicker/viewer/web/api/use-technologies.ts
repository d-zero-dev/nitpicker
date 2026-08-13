import type {
	TechnologyDirectoryStatsEntry,
	TechnologyInventoryEntry,
} from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** Response shape of `GET /api/technologies`. */
export interface TechnologiesResult {
	inventory: TechnologyInventoryEntry[];
	directoryDistribution: TechnologyDirectoryStatsEntry[];
}

/**
 * Fetches the site-wide technology inventory plus the directory ×
 * technology distribution matrix. Takes no parameters — the endpoint
 * always returns every detected technology in the archive.
 * @returns The TanStack Query result for the technologies overview.
 */
export function useTechnologies() {
	return useQuery({
		queryKey: ['technologies'],
		queryFn: () => apiGet<TechnologiesResult>('/api/technologies'),
	});
}
