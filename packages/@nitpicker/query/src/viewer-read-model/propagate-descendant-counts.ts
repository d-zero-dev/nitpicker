import type { DirectoryNodeInsertRow } from './types.js';

/**
 * Folds each node's own (direct-only, as set by the page-attachment loop)
 * `internal_descendant_page_count`/`descendant_html_page_count` up into its
 * parent — walking `nodes` from the last id to the first. A node is always
 * created after its parent (the path walk reaches a directory only through
 * its parent), so a child's id is larger than its parent's and every child
 * has been folded into a node before that node is folded into ITS parent:
 * every descendant at every depth is added exactly once, with no sort by
 * depth and no id → node map. Also finalises
 * `descendant_page_count` (the sum of the internal/external pair) and
 * `has_children` on every node. Mutates every row in `nodes` in place.
 *
 * `external_descendant_page_count` is not folded because it is structurally
 * always `0` — `buildDirectoryTreeRows` drops external rows before any node
 * exists, so no node ever carries a nonzero value to fold. The column itself
 * is retained (at `0`) to keep the read-model table and the
 * `DirectoryTreeNode` API shape stable.
 *
 * `direct_html_page_count` is NOT folded here — unlike
 * `descendant_html_page_count` (seeded with each node's own direct-HTML
 * count, then accumulated into a subtree total exactly like
 * `internal_descendant_page_count`), it must stay a direct-only count for
 * the caller, so it is left untouched by this pass.
 *
 * `has_children` is deliberately `direct_child_dir_count > 0` alone, NOT
 * `direct_child_dir_count + direct_page_count > 0` — every node this builder
 * creates ends up with at least one direct page or one child directory (a
 * node only exists because some page's path walk passed through or ended at
 * it), so a "has ANY child or page" definition would always be `true` and
 * carry no information. The viewer tree UI's expand arrow only ever reveals
 * child DIRECTORIES via `/api/directory-tree/children` (direct pages come
 * from the separate `/api/directory-tree/pages` panel, not additional tree
 * rows), so `has_children` answers exactly the question that UI needs: does
 * this node have anything to expand into.
 *
 * A node whose parent is missing, or whose parent id is not smaller than its
 * own, throws instead of being skipped: the walk is only correct under that
 * ordering, and skipping such a node would leave its whole subtree out of
 * every ancestor's count with no sign that anything is wrong.
 * @param nodes - Every node across every host's tree, in creation order
 *   (`nodes[i].node_id === i + 1`, every `parent_node_id` smaller than its
 *   own `node_id`). On entry, `internal_descendant_page_count`/
 *   `descendant_html_page_count` must hold only each node's OWN direct counts.
 * @throws {Error} When a node's parent is missing or does not have a smaller id.
 * @example
 * // root (id 1) → child (id 2) holding 3 pages
 * propagateDescendantCounts(nodes);
 * // nodes[0].descendant_page_count === 3
 */
export function propagateDescendantCounts(
	nodes: readonly DirectoryNodeInsertRow[],
): void {
	for (let index = nodes.length - 1; index >= 0; index--) {
		const node = nodes[index]!;
		if (node.parent_node_id === null) {
			continue;
		}
		const parent = nodes[node.parent_node_id - 1];
		if (!parent || node.parent_node_id >= node.node_id) {
			throw new Error(
				`propagateDescendantCounts: node ${node.node_id} names parent ${node.parent_node_id}, but a parent must exist and have a smaller id`,
			);
		}
		parent.internal_descendant_page_count += node.internal_descendant_page_count;
		parent.descendant_html_page_count += node.descendant_html_page_count;
	}
	for (const node of nodes) {
		node.descendant_page_count =
			node.internal_descendant_page_count + node.external_descendant_page_count;
		node.has_children = node.direct_child_dir_count > 0 ? 1 : 0;
	}
}
