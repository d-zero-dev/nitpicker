import { describe, expect, it } from 'vitest';

import { demoDirectoryTreeNode } from './demo-directory-tree-fixtures.js';

describe('demoDirectoryTreeNode', () => {
	it('defaults every count field to 0 and `hasChildren` to false', () => {
		const node = demoDirectoryTreeNode({
			nodeId: 1,
			parentNodeId: null,
			name: '',
			path: '/',
			depth: 0,
		});
		expect(node).toEqual({
			nodeId: 1,
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
		});
	});

	it('overrides only the fields passed in `partial`, leaving the rest at their default', () => {
		const node = demoDirectoryTreeNode({
			nodeId: 2,
			parentNodeId: 1,
			name: 'blog',
			path: '/blog/',
			depth: 1,
			hasChildren: true,
			descendantHtmlPageCount: 20,
		});
		expect(node.hasChildren).toBe(true);
		expect(node.descendantHtmlPageCount).toBe(20);
		expect(node.directPageCount).toBe(0);
		expect(node.childCount).toBe(0);
	});
});
