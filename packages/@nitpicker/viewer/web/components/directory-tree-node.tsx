import type { DirectoryTreeNode } from '@nitpicker/query';

import { INITIAL_DIRECTORY_TREE_DEPTH } from '@nitpicker/query/directory-tree-constants';
import { memo } from 'react';

import { useDirectoryTreeChildren } from '../api/use-directory-tree-children.js';
import { useI18n } from '../i18n/use-i18n.js';

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
	/** Toggles a node's expanded state, given its current value. */
	onToggle: (node: DirectoryTreeNode, isExpanded: boolean) => void;
	/** The currently selected node id, or `null` when none is selected. */
	selectedNodeId: number | null;
	/**
	 * Selects a node, so its direct pages show in the pages panel. Receives
	 * the full node (not just its id) — a dynamically fetched node (depth > 3)
	 * only ever exists in this component tree's `useDirectoryTreeChildren`
	 * results, so the caller cannot look it back up from an id alone.
	 */
	onSelect: (node: DirectoryTreeNode) => void;
}

/**
 * One recursive row in the directory tree. Renders an expand arrow only when
 * `node.hasChildren` is `true` — direct pages surface via the separate pages
 * panel, never as additional tree rows.
 *
 * A node's expanded state defaults to `node.depth < INITIAL_DIRECTORY_TREE_DEPTH`
 * (so the initial depth ≤ `INITIAL_DIRECTORY_TREE_DEPTH` payload renders as
 * an already-expanded tree, matching the "initial load shows the tree"
 * acceptance criteria) and `false` at the boundary depth and beyond — a
 * boundary node's children are fetched only after an explicit click, never
 * eagerly on load. Reads the same `@nitpicker/query` constant the backend's
 * `/api/directory-tree` cutoff uses, rather than an independent literal, so
 * the two can't silently drift apart. `expandedOverrides` records only the
 * nodes a user has explicitly toggled, so this default can flip in either
 * direction without needing to pre-populate every node id up front.
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
 * expand/select action (`expandedOverrides`/`selectedNodeId` are shared
 * state threaded to every row) — memoizing at least skips re-render when an
 * ancestor re-renders without any of this row's own props changing.
 * @param props - The row props.
 * @param props.node
 * @param props.childrenByParent
 * @param props.expandedOverrides
 * @param props.onToggle
 * @param props.selectedNodeId
 * @param props.onSelect
 * @returns The tree row element, plus its expanded subtree when applicable.
 */
export const DirectoryTreeNodeRow = memo(function DirectoryTreeNodeRow({
	node,
	childrenByParent,
	expandedOverrides,
	onToggle,
	selectedNodeId,
	onSelect,
}: DirectoryTreeNodeRowProps) {
	const { t } = useI18n();
	const defaultExpanded = node.depth < INITIAL_DIRECTORY_TREE_DEPTH;
	const isExpanded = expandedOverrides.get(node.nodeId) ?? defaultExpanded;
	const knownChildren = childrenByParent.get(node.nodeId) ?? [];
	const needsFetch = node.hasChildren && knownChildren.length === 0;

	const childrenQuery = useDirectoryTreeChildren(node.nodeId, {
		enabled: isExpanded && needsFetch,
	});

	const children = needsFetch ? (childrenQuery.data?.nodes ?? []) : knownChildren;

	const name = node.name || '/';
	const isSelected = selectedNodeId === node.nodeId;

	return (
		<li className="tree-node">
			<div className={`tree-row${isSelected ? ' is-selected' : ''}`}>
				{node.hasChildren ? (
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
						{isExpanded ? '▾' : '▸'}
					</button>
				) : (
					<span className="tree-toggle-spacer" aria-hidden="true" />
				)}
				<button
					type="button"
					className="tree-label link-button"
					aria-pressed={isSelected}
					onClick={() => {
						onSelect(node);
					}}>
					<span className="tree-name">{name}</span>
					<span className="tree-count">
						{t('views.directoryTree.childCount', { count: node.childCount })}
					</span>
				</button>
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
							onToggle={onToggle}
							selectedNodeId={selectedNodeId}
							onSelect={onSelect}
						/>
					))}
				</ul>
			)}
		</li>
	);
});
