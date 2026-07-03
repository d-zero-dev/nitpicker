import type { DirectoryTreeNode, ListDirectoryChildrenOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/** Default/defensive cap on returned rows — see {@link ListDirectoryChildrenOptions.limit}. */
const DEFAULT_LIMIT = 1000;

/** Row shape read from `viewer_directory_nodes` by {@link listDirectoryChildren}. */
interface DirectoryNodeRow {
	/** `viewer_directory_nodes.node_id`. */
	node_id: number;
	/** `viewer_directory_nodes.parent_node_id`. */
	parent_node_id: number | null;
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
		hasChildren: row.has_children === 1,
	};
}

/**
 * Reads the direct child directory nodes of one node — a single SELECT keyed
 * by `parent_node_id`, no recursive CTE. Implements
 * `docs/viewer-sql-query-plan.md`'s `/api/directory-tree/children` contract,
 * used to expand directories beyond the initial depth ≤ 3 load returned by
 * {@link getDirectoryTree}.
 *
 * No `rootKey` parameter is needed — a `nodeId` already uniquely identifies
 * which host's tree it belongs to.
 * @param accessor - The archive accessor to query.
 * @param options - See {@link ListDirectoryChildrenOptions}.
 * @returns The direct child directory nodes, ordered by name. Returns `[]`
 *   when the read model has not been built or is stale (see
 *   `getDirectoryTree`'s docs on why `isViewerReadModelCurrent`, not just
 *   `hasViewerReadModel`, guards this), or when `nodeId` has no children.
 * @example
 * // User clicked a collapsed node in the tree UI:
 * if (node.hasChildren) {
 *   const children = await listDirectoryChildren(accessor, { nodeId: node.nodeId });
 * }
 */
export async function listDirectoryChildren(
	accessor: ArchiveAccessor,
	options: ListDirectoryChildrenOptions,
): Promise<DirectoryTreeNode[]> {
	if (!(await isViewerReadModelCurrent(accessor))) {
		return [];
	}

	const knex = accessor.getKnex();
	const rows: DirectoryNodeRow[] = await knex('viewer_directory_nodes')
		.where('parent_node_id', options.nodeId)
		.select(
			'node_id',
			'parent_node_id',
			'name',
			'path',
			'depth',
			'direct_child_dir_count',
			'direct_page_count',
			knex.raw('direct_child_dir_count + direct_page_count as child_count'),
			'descendant_page_count',
			'internal_descendant_page_count',
			'external_descendant_page_count',
			'has_children',
		)
		.orderBy(['name_sort_key', 'node_id'])
		.limit(options.limit ?? DEFAULT_LIMIT);

	return rows.map(toDirectoryTreeNode);
}
