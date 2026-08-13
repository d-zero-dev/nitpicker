import type { Meta, StoryObj } from '@storybook/react-vite';

import { fn } from 'storybook/test';

import { demoDirectoryTreeNode } from './demo-directory-tree-fixtures.js';
import { DirectoryTreeNodeRow } from './directory-tree-node.js';

const root = demoDirectoryTreeNode({
	nodeId: 1,
	parentNodeId: null,
	name: '',
	path: '/',
	depth: 0,
});
const blog = demoDirectoryTreeNode({
	nodeId: 2,
	parentNodeId: 1,
	name: 'blog',
	path: '/blog/',
	depth: 1,
	hasChildren: true,
	directChildDirCount: 1,
	descendantHtmlPageCount: 20,
	descendantPageCount: 20,
	internalDescendantPageCount: 20,
});

const meta = {
	component: DirectoryTreeNodeRow,
	args: {
		childrenByParent: new Map([[1, [blog]]]),
		expandedOverrides: new Map(),
		collapseDepthThreshold: 3,
		sortOrder: 'path',
		onToggle: fn(),
		onSelect: fn(),
	},
} satisfies Meta<typeof DirectoryTreeNodeRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A host's root node — always expanded, no toggle of its own (see the component's `isRoot` doc). */
export const RootNode: Story = { args: { node: root } };

/** A leaf directory: no expand arrow since `hasChildren` is `false`. */
export const LeafNode: Story = {
	args: {
		node: demoDirectoryTreeNode({
			nodeId: 3,
			parentNodeId: 1,
			name: 'docs',
			path: '/docs/',
			depth: 1,
			directPageCount: 22,
			childCount: 22,
			descendantHtmlPageCount: 22,
			descendantPageCount: 22,
			internalDescendantPageCount: 22,
			directHtmlPageCount: 22,
		}),
	},
};
