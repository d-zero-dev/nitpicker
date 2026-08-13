import type { DirectoryTreeRoot } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { fn } from 'storybook/test';

import { demoDirectoryTreeNode } from './demo-directory-tree-fixtures.js';
import { DirectoryTree } from './directory-tree.js';

/**
 * A fully-materialized 3-level tree: every `hasChildren: true` node's
 * children are present here, so `DirectoryTreeNodeRow`'s `needsFetch` is
 * always `false` — no `/api/directory-tree/children` call is ever made (the
 * `QueryClientProvider` global decorator makes the hook callable, but
 * `enabled: false` keeps it inert).
 */
const root: DirectoryTreeRoot = {
	rootKey: 'example.com',
	nodes: [
		demoDirectoryTreeNode({
			nodeId: 1,
			parentNodeId: null,
			name: '',
			path: '/',
			depth: 0,
			hasChildren: true,
			directChildDirCount: 2,
			descendantHtmlPageCount: 42,
			descendantPageCount: 42,
			internalDescendantPageCount: 42,
		}),
		demoDirectoryTreeNode({
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
		}),
		demoDirectoryTreeNode({
			nodeId: 3,
			parentNodeId: 1,
			name: 'docs',
			path: '/docs/',
			depth: 1,
			hasChildren: false,
			directPageCount: 22,
			childCount: 22,
			descendantHtmlPageCount: 22,
			descendantPageCount: 22,
			internalDescendantPageCount: 22,
			directHtmlPageCount: 22,
		}),
		demoDirectoryTreeNode({
			nodeId: 4,
			parentNodeId: 2,
			name: '2026',
			path: '/blog/2026/',
			depth: 2,
			hasChildren: false,
			directPageCount: 20,
			childCount: 20,
			descendantHtmlPageCount: 20,
			descendantPageCount: 20,
			internalDescendantPageCount: 20,
			directHtmlPageCount: 20,
		}),
	],
};

const meta = {
	component: DirectoryTree,
	args: {
		root,
		expandedOverrides: new Map(),
		collapseDepthThreshold: 3,
		sortOrder: 'path',
		onToggle: fn(),
		onSelect: fn(),
	},
} satisfies Meta<typeof DirectoryTree>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Initial load: depth < 3 renders already expanded. */
export const Default: Story = {};

/** A node explicitly collapsed by the user via `expandedOverrides`. */
export const CollapsedNode: Story = {
	args: { expandedOverrides: new Map([[2, false]]) },
};
