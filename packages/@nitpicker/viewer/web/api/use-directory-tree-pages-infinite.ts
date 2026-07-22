import type { CursorPaginatedDirectoryPageList } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { PAGE_SIZE } from './page-size.js';

/**
 * Infinite-scrolling list of a directory node's direct pages (never its
 * descendants) via `GET /api/directory-tree/pages`. Forward-only keyset
 * pagination through the server-issued `nextCursor` — the endpoint has no
 * `prevCursor` or `total`, matching `listDirectoryPages`'s contract.
 * @param nodeId - The directory node whose direct pages to list.
 * @param options - Query options.
 * @param options.enabled - Whether the request should run.
 * @returns The TanStack infinite-query result.
 */
export function useDirectoryTreePagesInfinite(
	nodeId: number,
	options: { enabled: boolean },
) {
	return useInfiniteQuery({
		queryKey: ['directory-tree-pages', nodeId],
		initialPageParam: null as string | null,
		queryFn: ({ pageParam }) =>
			apiGet<CursorPaginatedDirectoryPageList>('/api/directory-tree/pages', {
				nodeId,
				limit: PAGE_SIZE,
				cursor: pageParam ?? undefined,
			}),
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled: options.enabled,
	});
}
