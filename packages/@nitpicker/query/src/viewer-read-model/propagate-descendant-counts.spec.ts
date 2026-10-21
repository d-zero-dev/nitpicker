import type { DirectoryNodeInsertRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { propagateDescendantCounts } from './propagate-descendant-counts.js';

/**
 * A node with only its own direct counts set, as the page-attachment loop
 * leaves it.
 * @param params - The node's fields; unset counts are 0.
 * @param params.nodeId - The node's id.
 * @param params.parentNodeId - The parent's id, or `null` for a root.
 * @param params.pages - The node's own page count (all internal).
 * @param params.htmlPages - The node's own HTML page count.
 * @param params.childDirs - How many child directories the node has.
 * @returns The node.
 */
function node(params: {
	nodeId: number;
	parentNodeId: number | null;
	pages?: number;
	htmlPages?: number;
	childDirs?: number;
}): DirectoryNodeInsertRow {
	return {
		node_id: params.nodeId,
		parent_node_id: params.parentNodeId,
		root_key: 'example.com',
		depth: 0,
		name: '',
		path: '/',
		name_sort_key: '',
		path_sort_key: '/',
		direct_child_dir_count: params.childDirs ?? 0,
		direct_page_count: params.pages ?? 0,
		descendant_page_count: 0,
		internal_descendant_page_count: params.pages ?? 0,
		external_descendant_page_count: 0,
		direct_html_page_count: params.htmlPages ?? 0,
		descendant_html_page_count: params.htmlPages ?? 0,
		has_children: 0,
	};
}

describe('propagateDescendantCounts', () => {
	it('folds every descendant into each ancestor exactly once', () => {
		// 1 ─ 2 ─ 3 ─ 4        (a chain)
		//  └─ 5                 (a sibling of 2)
		const nodes = [
			node({ nodeId: 1, parentNodeId: null, pages: 1, htmlPages: 1, childDirs: 2 }),
			node({ nodeId: 2, parentNodeId: 1, pages: 2, htmlPages: 0, childDirs: 1 }),
			node({ nodeId: 3, parentNodeId: 2, pages: 4, htmlPages: 3, childDirs: 1 }),
			node({ nodeId: 4, parentNodeId: 3, pages: 8, htmlPages: 8 }),
			node({ nodeId: 5, parentNodeId: 1, pages: 16, htmlPages: 1 }),
		];
		propagateDescendantCounts(nodes);
		expect(nodes.map((n) => n.descendant_page_count)).toEqual([31, 14, 12, 8, 16]);
		expect(nodes.map((n) => n.descendant_html_page_count)).toEqual([13, 11, 11, 8, 1]);
	});

	it('leaves the direct counts untouched', () => {
		const nodes = [
			node({ nodeId: 1, parentNodeId: null, pages: 1, htmlPages: 1, childDirs: 1 }),
			node({ nodeId: 2, parentNodeId: 1, pages: 5, htmlPages: 2 }),
		];
		propagateDescendantCounts(nodes);
		expect(nodes.map((n) => n.direct_page_count)).toEqual([1, 5]);
		expect(nodes.map((n) => n.direct_html_page_count)).toEqual([1, 2]);
	});

	it('sets has_children from the child directory count alone', () => {
		const nodes = [
			node({ nodeId: 1, parentNodeId: null, pages: 3, childDirs: 1 }),
			node({ nodeId: 2, parentNodeId: 1, pages: 3 }),
		];
		propagateDescendantCounts(nodes);
		expect(nodes.map((n) => n.has_children)).toEqual([1, 0]);
	});

	it('keeps separate trees apart', () => {
		const nodes = [
			node({ nodeId: 1, parentNodeId: null, pages: 1, childDirs: 1 }),
			node({ nodeId: 2, parentNodeId: null, pages: 10, childDirs: 1 }),
			node({ nodeId: 3, parentNodeId: 1, pages: 2 }),
			node({ nodeId: 4, parentNodeId: 2, pages: 20 }),
		];
		propagateDescendantCounts(nodes);
		expect(nodes.map((n) => n.descendant_page_count)).toEqual([3, 30, 2, 20]);
	});

	it('does nothing for no nodes', () => {
		expect(() => propagateDescendantCounts([])).not.toThrow();
	});

	it('throws for a node whose parent does not exist, rather than leaving its subtree uncounted', () => {
		const nodes = [
			node({ nodeId: 1, parentNodeId: null, pages: 1 }),
			node({ nodeId: 2, parentNodeId: 9, pages: 1 }),
		];
		expect(() => propagateDescendantCounts(nodes)).toThrow(/node 2 names parent 9/);
	});

	it('throws for a node whose parent id is not smaller than its own', () => {
		const nodes = [
			node({ nodeId: 1, parentNodeId: 2, pages: 1 }),
			node({ nodeId: 2, parentNodeId: null, pages: 1 }),
		];
		expect(() => propagateDescendantCounts(nodes)).toThrow(/node 1 names parent 2/);
	});
});
