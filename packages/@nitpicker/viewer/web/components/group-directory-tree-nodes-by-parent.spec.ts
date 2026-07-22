import type { DirectoryTreeNode } from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { groupDirectoryTreeNodesByParent } from './group-directory-tree-nodes-by-parent.js';

/**
 *
 * @param overrides
 */
function makeNode(overrides: Partial<DirectoryTreeNode>): DirectoryTreeNode {
	return {
		nodeId: 0,
		parentNodeId: null,
		name: '',
		path: '/',
		depth: 0,
		directChildDirCount: 0,
		directPageCount: 0,
		childCount: 0,
		descendantPageCount: 0,
		internalDescendantPageCount: 0,
		externalDescendantPageCount: 0,
		hasChildren: false,
		...overrides,
	};
}

describe('groupDirectoryTreeNodesByParent', () => {
	it('returns an empty map for an empty node list', () => {
		expect(groupDirectoryTreeNodesByParent([])).toEqual(new Map());
	});

	it('groups root nodes (parentNodeId: null) under the null key', () => {
		const root = makeNode({ nodeId: 1, parentNodeId: null, depth: 0 });
		const grouped = groupDirectoryTreeNodesByParent([root]);
		expect(grouped.get(null)).toEqual([root]);
	});

	it('groups multiple children under their shared parentNodeId', () => {
		const blog = makeNode({ nodeId: 2, parentNodeId: 1, name: 'blog', depth: 1 });
		const docs = makeNode({ nodeId: 3, parentNodeId: 1, name: 'docs', depth: 1 });
		const grouped = groupDirectoryTreeNodesByParent([blog, docs]);
		expect(grouped.get(1)).toEqual([blog, docs]);
	});

	it('keeps distinct parents in separate buckets', () => {
		const child1 = makeNode({ nodeId: 10, parentNodeId: 1 });
		const child2 = makeNode({ nodeId: 20, parentNodeId: 2 });
		const grouped = groupDirectoryTreeNodesByParent([child1, child2]);
		expect(grouped.get(1)).toEqual([child1]);
		expect(grouped.get(2)).toEqual([child2]);
	});

	it('does not return an entry for a parentNodeId with no known children', () => {
		const grouped = groupDirectoryTreeNodesByParent([
			makeNode({ nodeId: 1, parentNodeId: 5 }),
		]);
		expect(grouped.has(999)).toBe(false);
	});
});
