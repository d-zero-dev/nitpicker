import type { DirectoryTreeSortOrder } from '../types.js';
import type { DirectoryTreeNode, DirectoryTreeRoot } from '@nitpicker/query';

import { useMemo } from 'react';

import { DirectoryTreeNodeRow } from './directory-tree-node.js';
import { groupDirectoryTreeNodesByParent } from './group-directory-tree-nodes-by-parent.js';
import { sortDirectoryTreeNodes } from './sort-directory-tree-nodes.js';

/** Props for {@link DirectoryTree}. */
export interface DirectoryTreeProps {
	/** One host's worth of initial (depth ≤ 3) directory-tree nodes. */
	root: DirectoryTreeRoot;
	/** Explicit expand/collapse overrides, keyed by node id. */
	expandedOverrides: Map<number, boolean>;
	/** A node with `depth` below this value defaults to expanded; see {@link import('./directory-tree-node.js').DirectoryTreeNodeRowProps.collapseDepthThreshold}. */
	collapseDepthThreshold: number;
	/** The sibling ordering applied within every level of the tree. */
	sortOrder: DirectoryTreeSortOrder;
	/** Toggles a node's expanded state, given its current value. */
	onToggle: (node: DirectoryTreeNode, isExpanded: boolean) => void;
	/** Navigates to the Pages view filtered to a node's subtree. */
	onSelect: (node: DirectoryTreeNode) => void;
}

/**
 * Renders one root host's directory tree, reconstructed client-side from
 * {@link DirectoryTreeRoot.nodes}' flat `parentNodeId` links (the backend
 * never nests server-side).
 * @param props - The tree props.
 * @param props.root
 * @param props.expandedOverrides
 * @param props.collapseDepthThreshold
 * @param props.sortOrder
 * @param props.onToggle
 * @param props.onSelect
 * @returns The tree element, or `null` if the root has no root node (should
 *   not happen for a well-formed payload).
 */
export function DirectoryTree({
	root,
	expandedOverrides,
	collapseDepthThreshold,
	sortOrder,
	onToggle,
	onSelect,
}: DirectoryTreeProps) {
	const childrenByParent = useMemo(() => {
		const grouped = groupDirectoryTreeNodesByParent(root.nodes);
		if (sortOrder === 'path') {
			return grouped;
		}
		return new Map(
			[...grouped].map(([parentNodeId, children]) => [
				parentNodeId,
				sortDirectoryTreeNodes(children, sortOrder),
			]),
		);
	}, [root.nodes, sortOrder]);
	const rootNode = root.nodes.find((node) => node.parentNodeId === null);

	if (!rootNode) {
		return null;
	}

	return (
		<div className="directory-tree">
			<h3 className="directory-tree-host">{root.rootKey}</h3>
			<ul className="tree-root">
				<DirectoryTreeNodeRow
					node={rootNode}
					childrenByParent={childrenByParent}
					expandedOverrides={expandedOverrides}
					collapseDepthThreshold={collapseDepthThreshold}
					sortOrder={sortOrder}
					onToggle={onToggle}
					onSelect={onSelect}
				/>
			</ul>
		</div>
	);
}
