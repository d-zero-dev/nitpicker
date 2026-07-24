import type { DirectoryTreeNode } from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { sortDirectoryTreeNodes } from './sort-directory-tree-nodes.js';

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
		directHtmlPageCount: 0,
		descendantHtmlPageCount: 0,
		hasChildren: false,
		...overrides,
	};
}

describe('sortDirectoryTreeNodes', () => {
	it('returns the same array instance for "path" (no client-side reordering)', () => {
		const nodes = [makeNode({ nodeId: 1 }), makeNode({ nodeId: 2 })];
		expect(sortDirectoryTreeNodes(nodes, 'path')).toBe(nodes);
	});

	it('sorts by descendantHtmlPageCount descending for "pagesDesc"', () => {
		const few = makeNode({ nodeId: 1, name: 'few', descendantHtmlPageCount: 2 });
		const many = makeNode({ nodeId: 2, name: 'many', descendantHtmlPageCount: 10 });
		const none = makeNode({ nodeId: 3, name: 'none', descendantHtmlPageCount: 0 });
		expect(sortDirectoryTreeNodes([few, many, none], 'pagesDesc')).toEqual([
			many,
			few,
			none,
		]);
	});

	it('sorts by descendantHtmlPageCount ascending for "pagesAsc"', () => {
		const few = makeNode({ nodeId: 1, name: 'few', descendantHtmlPageCount: 2 });
		const many = makeNode({ nodeId: 2, name: 'many', descendantHtmlPageCount: 10 });
		const none = makeNode({ nodeId: 3, name: 'none', descendantHtmlPageCount: 0 });
		expect(sortDirectoryTreeNodes([few, many, none], 'pagesAsc')).toEqual([
			none,
			few,
			many,
		]);
	});

	it('does not mutate the input array for the page-count orders', () => {
		const nodes = [
			makeNode({ nodeId: 1, descendantHtmlPageCount: 5 }),
			makeNode({ nodeId: 2, descendantHtmlPageCount: 1 }),
		];
		const original = [...nodes];
		sortDirectoryTreeNodes(nodes, 'pagesDesc');
		expect(nodes).toEqual(original);
	});

	it('returns an empty array unchanged for any sort order', () => {
		expect(sortDirectoryTreeNodes([], 'pagesDesc')).toEqual([]);
	});
});
