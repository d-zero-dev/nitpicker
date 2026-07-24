import type { DirectoryTreeSortOrder } from '../types.js';
import type { DirectoryTreeNode } from '@nitpicker/query';

import { memo, useMemo } from 'react';

import { useDirectoryTreeChildren } from '../api/use-directory-tree-children.js';
import { useI18n } from '../i18n/use-i18n.js';

import { sortDirectoryTreeNodes } from './sort-directory-tree-nodes.js';

/** Props for {@link DirectoryTreeNodeRow}. */
export interface DirectoryTreeNodeRowProps {
	/** The node this row renders. */
	node: DirectoryTreeNode;
	/**
	 * Children already known for this node (and, transitively, its
	 * descendants), keyed by `parentNodeId` — the initial depth ≤ 3 payload's
	 * grouping, passed unchanged to every descendant regardless of depth.
	 * A dynamically fetched node's id (depth > 3) is, by construction, never
	 * a key in this map, so looking it up always yields "no known children"
	 * whether or not the map was rebuilt for that subtree — passing the same
	 * map through everywhere is equivalent to (and simpler than) swapping in
	 * a fresh empty map at each fetched boundary.
	 */
	childrenByParent: Map<number | null, DirectoryTreeNode[]>;
	/**
	 * Explicit expand/collapse overrides, keyed by node id — only ever
	 * populated by a user click (see {@link DirectoryTreeNodeRow}'s expanded
	 * state doc for the default a missing entry falls back to).
	 */
	expandedOverrides: Map<number, boolean>;
	/**
	 * A node with `depth` below this value defaults to expanded; at or past
	 * it, collapsed. Owned by `DirectoryTreeView` — its initial value
	 * matches `INITIAL_DIRECTORY_TREE_DEPTH` (the backend's initial-payload
	 * cutoff, so the tree loads already expanded to match), but the
	 * "collapse to depth" control can lower or raise it at any time by
	 * resetting `expandedOverrides` alongside it.
	 */
	collapseDepthThreshold: number;
	/** The sibling ordering applied within every level of the tree. */
	sortOrder: DirectoryTreeSortOrder;
	/** Toggles a node's expanded state, given its current value. */
	onToggle: (node: DirectoryTreeNode, isExpanded: boolean) => void;
	/**
	 * Navigates to the Pages view filtered to this node's subtree. Receives
	 * the full node (not just its id) since the caller needs `node.path`.
	 */
	onSelect: (node: DirectoryTreeNode) => void;
}

/**
 * One recursive row in the directory tree. Renders an expand arrow only when
 * `node.hasChildren` is `true` AND the node isn't a host's root — direct
 * pages surface via the Pages view (navigated to on click), never as
 * additional tree rows, and the root itself has no toggle at all (see
 * `isRoot` below).
 *
 * A node's expanded state defaults to `node.depth < collapseDepthThreshold`
 * (initially `INITIAL_DIRECTORY_TREE_DEPTH`, so the initial depth ≤ that
 * payload renders as an already-expanded tree, matching the "initial load
 * shows the tree" acceptance criteria) and `false` at or past the
 * threshold — a boundary node's children are fetched only after crossing
 * that threshold (an explicit click, or the "collapse to depth" control
 * raising it), never eagerly on load. `expandedOverrides` records only the
 * nodes a user has explicitly toggled, so this default can flip in either
 * direction without needing to pre-populate every node id up front. A
 * host's root node is the one exception — it is always expanded and has no
 * toggle to collapse it, since collapsing the single row every other row
 * nests under would hide the entire tree behind one click.
 *
 * Whether this node's children need a network fetch is decided purely by
 * whether they are already present in `childrenByParent` — never by
 * `node.depth`. The initial `/api/directory-tree` payload only covers
 * depth ≤ `INITIAL_DIRECTORY_TREE_DEPTH`, so a boundary node's children are
 * always absent and must be fetched via `/api/directory-tree/children`;
 * every deeper node reached that way is, in turn, its own boundary node, and
 * the same absence check applies recursively with no hardcoded depth cutoff.
 *
 * Memoized because every row in the visible tree re-renders on any single
 * expand action (`expandedOverrides` is shared state threaded to every row)
 * — memoizing at least skips re-render when an ancestor re-renders without
 * any of this row's own props changing.
 * @param props - The row props.
 * @param props.node
 * @param props.childrenByParent
 * @param props.expandedOverrides
 * @param props.collapseDepthThreshold
 * @param props.sortOrder
 * @param props.onToggle
 * @param props.onSelect
 * @returns The tree row element, plus its expanded subtree when applicable.
 */
export const DirectoryTreeNodeRow = memo(function DirectoryTreeNodeRow({
	node,
	childrenByParent,
	expandedOverrides,
	collapseDepthThreshold,
	sortOrder,
	onToggle,
	onSelect,
}: DirectoryTreeNodeRowProps) {
	const { t } = useI18n();
	// A host's root node (the top of the tree, not just a shallow depth) is
	// always shown expanded — collapsing the one row every other row nests
	// under would hide the entire tree behind a single click, which isn't a
	// useful "collapsed" state the way it is for any other directory.
	const isRoot = node.parentNodeId === null;
	const defaultExpanded = node.depth < collapseDepthThreshold;
	const isExpanded = isRoot || (expandedOverrides.get(node.nodeId) ?? defaultExpanded);
	const knownChildren = useMemo(
		() => childrenByParent.get(node.nodeId) ?? [],
		[childrenByParent, node.nodeId],
	);
	const needsFetch = node.hasChildren && knownChildren.length === 0;

	const childrenQuery = useDirectoryTreeChildren(node.nodeId, {
		enabled: isExpanded && needsFetch,
	});

	// `knownChildren` is already sorted by `DirectoryTree` (the same grouping
	// covers every depth), but a dynamically fetched page arrives raw from
	// `/api/directory-tree/children` and must be sorted here before render.
	const fetchedChildren = childrenQuery.data?.nodes;
	const children = useMemo(
		() =>
			needsFetch
				? sortDirectoryTreeNodes(fetchedChildren ?? [], sortOrder)
				: knownChildren,
		[needsFetch, fetchedChildren, sortOrder, knownChildren],
	);

	const name = node.name || '/';
	// A leaf directory (no children to expand into) has no open/closed
	// state of its own, so it always reads as "closed".
	const folderIcon = node.hasChildren && isExpanded ? '📂' : '📁';

	return (
		<li className="tree-node">
			<div className="tree-row">
				<button
					type="button"
					className="tree-label link-button"
					onClick={() => {
						onSelect(node);
					}}>
					<span className="tree-icon" aria-hidden="true">
						{folderIcon}
					</span>
					<span className="tree-name">{name}</span>
					<span className="tree-count">
						{t('views.directoryTree.pageCount', {
							count: node.descendantHtmlPageCount.toLocaleString(),
						})}
					</span>
				</button>
				{node.hasChildren && !isRoot ? (
					<button
						type="button"
						className="tree-toggle"
						aria-expanded={isExpanded}
						aria-label={
							isExpanded
								? t('views.directoryTree.collapseNode', { name })
								: t('views.directoryTree.expandNode', { name })
						}
						onClick={() => {
							onToggle(node, isExpanded);
						}}>
						<svg
							className="tree-toggle-icon"
							viewBox="0 0 24 24"
							width="18"
							height="18"
							aria-hidden="true"
							style={{ transform: isExpanded ? 'rotate(90deg)' : undefined }}>
							<path
								d="M9 6l6 6-6 6"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</button>
				) : (
					<span className="tree-toggle-spacer" aria-hidden="true" />
				)}
			</div>
			{isExpanded && node.hasChildren && (
				<ul className="tree-children">
					{needsFetch && childrenQuery.isLoading && (
						<li className="tree-loading">{t('common.loading')}</li>
					)}
					{needsFetch && childrenQuery.isError && (
						<li className="tree-error" role="alert">
							{childrenQuery.error.message}
						</li>
					)}
					{children.map((child) => (
						<DirectoryTreeNodeRow
							key={child.nodeId}
							node={child}
							childrenByParent={childrenByParent}
							expandedOverrides={expandedOverrides}
							collapseDepthThreshold={collapseDepthThreshold}
							sortOrder={sortOrder}
							onToggle={onToggle}
							onSelect={onSelect}
						/>
					))}
				</ul>
			)}
		</li>
	);
});
