import type { DirectoryTreeRoot } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** Shape of `GET /api/directory-tree`'s response. */
interface DirectoryTreeResponse {
	roots: DirectoryTreeRoot[];
}

/**
 * Fetches the initial (depth ≤ 3) directory tree for every root host in the
 * archive. The response is flat per root — `DirectoryTreeNode.parentNodeId`
 * is the only structural link, so callers reconstruct the nested UI tree
 * client-side (see `groupDirectoryTreeNodesByParent`).
 * @returns The TanStack Query result for the directory tree.
 */
export function useDirectoryTree() {
	return useQuery({
		queryKey: ['directory-tree'],
		queryFn: () => apiGet<DirectoryTreeResponse>('/api/directory-tree'),
	});
}
