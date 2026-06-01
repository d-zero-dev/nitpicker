import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** Metadata about the opened archive. */
interface ArchiveInfo {
	/** Absolute path of the `.nitpicker` archive being viewed. */
	filePath: string;
}

/**
 * Fetches metadata about the opened archive (its file path).
 * @returns The TanStack Query result for the archive info.
 */
export function useArchiveInfo() {
	return useQuery({
		queryKey: ['archive-info'],
		queryFn: () => apiGet<ArchiveInfo>('/api/info'),
		staleTime: Number.POSITIVE_INFINITY,
	});
}
