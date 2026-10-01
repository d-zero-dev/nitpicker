import type { TemplateClusterSummary } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';

import { TemplateClusterBlockGroups } from './template-cluster-block-groups.js';

const meta = {
	component: TemplateClusterBlockGroups,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof TemplateClusterBlockGroups>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Builds a cluster in the `css:abc` block with the given distinctive stylesheets.
 * @param index - The cluster index within the block.
 * @param pageCount - The cluster's page count.
 * @param directory - The cluster's top directory.
 * @param names - The reason's `distinctiveStylesheetFileNames`.
 * @returns The cluster summary.
 */
function cssCluster(
	index: number,
	pageCount: number,
	directory: string,
	names: string[],
): TemplateClusterSummary {
	return {
		templateKey: `["css:166e4235afcb8b15","cluster:${index}"]`,
		pageCount,
		commonDirectories: [{ directory, pageCount }],
		commonStylesheetUrls: [],
		commonStylesheetFileNames: names,
		reason: {
			clusteredMemberCount: pageCount,
			blocking: [],
			distinctiveStylesheetUrls: [],
			distinctiveStylesheetFileNames: names,
			structuralCoreTokens: [],
			structuralCoreTokenCount: 0,
			landmarks: [],
			siblingClusterKeys: [],
		},
	};
}

/**
 * A listing-page cluster Stage B merged across the `/blogs/` and `/news/`
 * blocks — listed under both, each row naming the other.
 */
const mergedListingCluster: TemplateClusterSummary = {
	templateKey: '["orphan-merge:blogs","cluster:1"]',
	pageCount: 13,
	commonDirectories: [
		{ directory: 'https://example.com/blogs/', pageCount: 7 },
		{ directory: 'https://example.com/news/', pageCount: 6 },
	],
	commonStylesheetUrls: [],
	commonStylesheetFileNames: [],
	reason: {
		clusteredMemberCount: 13,
		blocking: [
			{
				blockKey: 'orphan-merge:blogs',
				reason: { kind: 'orphanMerge', pathKey: 'blogs' },
			},
			{ blockKey: 'orphan-merge:news', reason: { kind: 'orphanMerge', pathKey: 'news' } },
		],
		distinctiveStylesheetUrls: [],
		distinctiveStylesheetFileNames: [],
		structuralCoreTokens: [],
		structuralCoreTokenCount: 0,
		landmarks: [],
		siblingClusterKeys: ['["orphan-merge:blogs","cluster:0"]'],
	},
};

/** A css block split into three clusters, two orphan-merge blocks sharing a merged cluster, and a path block. */
export const Default: Story = {
	args: {
		groups: [
			{
				block: { blockKey: 'css:166e4235afcb8b15', kind: 'css' },
				pageCount: 300,
				clusters: [
					cssCluster(0, 210, 'https://example.com/products/', ['product.css']),
					cssCluster(1, 60, 'https://example.com/products/', ['product.css']),
					cssCluster(2, 30, 'https://example.com/campaign/', ['product.css']),
				],
			},
			{
				block: { blockKey: 'orphan-merge:blogs', kind: 'orphanMerge' },
				pageCount: 93,
				clusters: [
					{
						templateKey: '["orphan-merge:blogs","cluster:0"]',
						pageCount: 80,
						commonDirectories: [
							{ directory: 'https://example.com/blogs/', pageCount: 80 },
						],
						commonStylesheetUrls: [],
						commonStylesheetFileNames: [],
						reason: null,
					},
					mergedListingCluster,
				],
			},
			{
				block: { blockKey: 'orphan-merge:news', kind: 'orphanMerge' },
				pageCount: 13,
				clusters: [mergedListingCluster],
			},
			{
				block: { blockKey: 'path:', kind: 'path' },
				pageCount: 1,
				clusters: [
					{
						templateKey: '["path:","cluster:0"]',
						pageCount: 1,
						commonDirectories: [],
						commonStylesheetUrls: [],
						commonStylesheetFileNames: [],
						reason: null,
					},
				],
			},
		],
	},
};
