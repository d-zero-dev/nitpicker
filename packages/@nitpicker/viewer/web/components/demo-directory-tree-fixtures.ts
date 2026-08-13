import type { DirectoryTreeNode } from '@nitpicker/query';

/**
 * Fills in every {@link DirectoryTreeNode} field with a reasonable default so
 * each story (directory-tree, directory-tree-node) only has to specify what
 * actually varies.
 * @param partial - The fields that vary for this node; the rest default to zero/`false`.
 * @returns A complete {@link DirectoryTreeNode}.
 */
export function demoDirectoryTreeNode(
	partial: Partial<DirectoryTreeNode> &
		Pick<DirectoryTreeNode, 'nodeId' | 'parentNodeId' | 'name' | 'path' | 'depth'>,
): DirectoryTreeNode {
	return {
		directChildDirCount: 0,
		directPageCount: 0,
		childCount: 0,
		descendantPageCount: 0,
		internalDescendantPageCount: 0,
		externalDescendantPageCount: 0,
		directHtmlPageCount: 0,
		descendantHtmlPageCount: 0,
		hasChildren: false,
		...partial,
	};
}
