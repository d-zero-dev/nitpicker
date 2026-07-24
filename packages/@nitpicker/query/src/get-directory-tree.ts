import type { DirectoryTreeNode, DirectoryTreeRoot } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { INITIAL_DIRECTORY_TREE_DEPTH } from './directory-tree-constants.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/** Row shape read from `viewer_directory_nodes` by {@link getDirectoryTree}. */
interface DirectoryNodeRow {
	/** `viewer_directory_nodes.node_id`. */
	node_id: number;
	/** `viewer_directory_nodes.parent_node_id`. */
	parent_node_id: number | null;
	/** `viewer_directory_nodes.root_key`. */
	root_key: string;
	/** `viewer_directory_nodes.name`. */
	name: string;
	/** `viewer_directory_nodes.path`. */
	path: string;
	/** `viewer_directory_nodes.depth`. */
	depth: number;
	/** `viewer_directory_nodes.direct_child_dir_count`. */
	direct_child_dir_count: number;
	/** `viewer_directory_nodes.direct_page_count`. */
	direct_page_count: number;
	/** `direct_child_dir_count + direct_page_count`, computed in SQL. */
	child_count: number;
	/** `viewer_directory_nodes.descendant_page_count`. */
	descendant_page_count: number;
	/** `viewer_directory_nodes.internal_descendant_page_count`. */
	internal_descendant_page_count: number;
	/** `viewer_directory_nodes.external_descendant_page_count`. */
	external_descendant_page_count: number;
	/** `viewer_directory_nodes.direct_html_page_count`. */
	direct_html_page_count: number;
	/** `viewer_directory_nodes.descendant_html_page_count`. */
	descendant_html_page_count: number;
	/** `viewer_directory_nodes.has_children`. */
	has_children: number;
}

/**
 * Maps one {@link DirectoryNodeRow} to its public {@link DirectoryTreeNode} shape.
 * @param row - The source row.
 * @returns The mapped node.
 */
function toDirectoryTreeNode(row: DirectoryNodeRow): DirectoryTreeNode {
	return {
		nodeId: row.node_id,
		parentNodeId: row.parent_node_id,
		name: row.name,
		path: row.path,
		depth: row.depth,
		directChildDirCount: row.direct_child_dir_count,
		directPageCount: row.direct_page_count,
		childCount: row.child_count,
		descendantPageCount: row.descendant_page_count,
		internalDescendantPageCount: row.internal_descendant_page_count,
		externalDescendantPageCount: row.external_descendant_page_count,
		directHtmlPageCount: row.direct_html_page_count,
		descendantHtmlPageCount: row.descendant_html_page_count,
		hasChildren: row.has_children === 1,
	};
}

/**
 * Reads the initial directory tree for every root (host) present in the
 * archive's `viewer_directory_nodes` read model — depth ≤ 3 per host, flat
 * (parent links only, no server-side nested tree construction), ordered by
 * `path_sort_key`. The `/api/directory-tree` contract this implements: one
 * SELECT total (grouped by `root_key` in JS afterward), no recursive CTE, no
 * GET-time counting — every count column is precomputed at build time.
 *
 * Takes no `rootKey` parameter by design — the archive already knows which
 * hosts it crawled, so requiring a caller to guess or discover one first
 * would be redundant. Callers needing a single host's tree just filter the
 * returned array.
 * @param accessor - The archive accessor to query.
 * @returns One entry per distinct `root_key` with at least one node, each
 *   carrying its flat depth ≤ 3 node list. Returns `[]` when the read model
 *   has not been built, or has been built under a stale schema version (no
 *   legacy fallback exists for this feature, unlike `/api/pages` —
 *   `isViewerReadModelCurrent` is checked, not just `hasViewerReadModel`,
 *   so a v3-or-earlier read model — built before `viewer_directory_nodes`
 *   existed — returns `[]` instead of throwing a "no such table" error).
 * @example
 * // Render every root's initial tree; expand deeper nodes on demand via
 * // listDirectoryChildren(accessor, { nodeId }).
 * const roots = await getDirectoryTree(accessor);
 * const primary = roots.find((r) => r.rootKey === 'example.com');
 */
export async function getDirectoryTree(
	accessor: ArchiveAccessor,
): Promise<DirectoryTreeRoot[]> {
	if (!(await isViewerReadModelCurrent(accessor))) {
		return [];
	}

	const knex = accessor.getKnex();
	const rows: DirectoryNodeRow[] = await knex('viewer_directory_nodes')
		.where('depth', '<=', INITIAL_DIRECTORY_TREE_DEPTH)
		.select(
			'node_id',
			'parent_node_id',
			'root_key',
			'name',
			'path',
			'depth',
			'direct_child_dir_count',
			'direct_page_count',
			knex.raw('direct_child_dir_count + direct_page_count as child_count'),
			'descendant_page_count',
			'internal_descendant_page_count',
			'external_descendant_page_count',
			'direct_html_page_count',
			'descendant_html_page_count',
			'has_children',
		)
		// Deliberately `path_sort_key` alone, NOT `['root_key', 'path_sort_key']`
		// — see `vdn_path_depth`'s comment in create-viewer-read-model-tables.ts
		// for why leading the sort with `root_key` would defeat the index. A
		// single global ascending sort by `path_sort_key` still leaves each
		// root_key's own subsequence of rows correctly ordered by path once
		// grouped below — sorting by one key and then filtering to a subset
		// preserves that subset's relative order.
		.orderBy('path_sort_key');

	const rootsByKey = new Map<string, DirectoryTreeRoot>();
	for (const row of rows) {
		let root = rootsByKey.get(row.root_key);
		if (!root) {
			root = { rootKey: row.root_key, nodes: [] };
			rootsByKey.set(row.root_key, root);
		}
		root.nodes.push(toDirectoryTreeNode(row));
	}
	return [...rootsByKey.values()];
}
