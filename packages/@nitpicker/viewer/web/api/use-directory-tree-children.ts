import type { DirectoryTreeNode } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** Shape of `GET /api/directory-tree/children`'s response. */
interface DirectoryTreeChildrenResponse {
	nodes: DirectoryTreeNode[];
}

/**
 * Fetches one directory node's direct child directories from
 * `GET /api/directory-tree/children?nodeId=`, for on-demand expansion of a
 * tree row whose children were not part of the initial depth ≤ 3 payload.
 *
 * `enabled` suppresses the request until the row is actually expanded — the
 * tree renders every node up front but must not eagerly fetch every
 * boundary node's children on mount.
 * @param nodeId - The directory node whose direct children to fetch.
 * @param options - Query options.
 * @param options.enabled - Whether the request should run.
 * @returns The TanStack Query result for the node's children.
 */
export function useDirectoryTreeChildren(nodeId: number, options: { enabled: boolean }) {
	return useQuery({
		queryKey: ['directory-tree-children', nodeId],
		queryFn: () =>
			apiGet<DirectoryTreeChildrenResponse>('/api/directory-tree/children', { nodeId }),
		enabled: options.enabled,
	});
}
