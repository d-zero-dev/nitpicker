import type { DirectoryTreeNode } from '@nitpicker/query';

/**
 * Groups a flat {@link DirectoryTreeNode} list by `parentNodeId`, so a root
 * node's children (and their children, recursively) can be looked up in
 * O(1) while rendering the nested tree UI.
 *
 * A host's root node (`parentNodeId: null`) is grouped under the `null` key.
 * A `parentNodeId` absent from the input never appears as a key — callers
 * treat a missing key the same as an empty array (no known children yet).
 * @param nodes - The flat node list from `GET /api/directory-tree` or `GET /api/directory-tree/children`.
 * @returns A map from `parentNodeId` to its direct children, in input order.
 */
export function groupDirectoryTreeNodesByParent(
	nodes: DirectoryTreeNode[],
): Map<number | null, DirectoryTreeNode[]> {
	const grouped = new Map<number | null, DirectoryTreeNode[]>();
	for (const node of nodes) {
		const siblings = grouped.get(node.parentNodeId);
		if (siblings) {
			siblings.push(node);
		} else {
			grouped.set(node.parentNodeId, [node]);
		}
	}
	return grouped;
}
