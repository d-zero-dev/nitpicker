import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** Metadata about the opened archive. */
interface ArchiveInfo {
	/** Absolute path of the opened source being viewed. */
	filePath: string;
	/** Whether the source is a finished archive file or a live crawl stub directory. */
	mode: 'archive' | 'stub';
	/**
	 * PID of a crawler currently writing the stub, as detected at viewer
	 * startup. `null` for archive sources, and for stub sources where the
	 * crawler had already exited (interrupted crawl).
	 */
	crawlerPid: number | null;
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
