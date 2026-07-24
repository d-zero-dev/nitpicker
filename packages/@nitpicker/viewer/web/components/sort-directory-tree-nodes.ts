import type { DirectoryTreeSortOrder } from '../types.js';
import type { DirectoryTreeNode } from '@nitpicker/query';

/**
 * Reorders a directory-tree node array per `sortOrder`. `'path'` (the
 * default) is a no-op — the backend already returns nodes in path order, and
 * this function must not reorder them when no client-side sort is
 * requested. The other two orders are computed purely from
 * `descendantHtmlPageCount`, already present on every node, so no additional
 * request is needed.
 * @param nodes - The nodes to sort, e.g. one level's siblings.
 * @param sortOrder - The requested order.
 * @returns `nodes` unchanged for `'path'`; otherwise a new array sorted by
 *   `descendantHtmlPageCount`.
 */
export function sortDirectoryTreeNodes(
	nodes: DirectoryTreeNode[],
	sortOrder: DirectoryTreeSortOrder,
): DirectoryTreeNode[] {
	if (sortOrder === 'path') {
		return nodes;
	}
	const direction = sortOrder === 'pagesDesc' ? -1 : 1;
	return nodes.toSorted(
		(a, b) => direction * (a.descendantHtmlPageCount - b.descendantHtmlPageCount),
	);
}
