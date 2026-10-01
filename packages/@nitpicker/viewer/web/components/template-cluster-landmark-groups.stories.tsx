import type { TemplateClusterSummary } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';

import { TemplateClusterLandmarkGroups } from './template-cluster-landmark-groups.js';

const meta = {
	component: TemplateClusterLandmarkGroups,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof TemplateClusterLandmarkGroups>;

export default meta;
type Story = StoryObj<typeof meta>;

const cluster: TemplateClusterSummary = {
	templateKey: '["css:166e4235afcb8b15","cluster:0"]',
	pageCount: 42,
	commonDirectories: [{ directory: '/products/', pageCount: 42 }],
	commonStylesheetUrls: [],
	commonStylesheetFileNames: ['product.css'],
	reason: null,
};

/** Header and footer groups sharing one cluster. */
export const Default: Story = {
	args: {
		groups: [
			{
				type: 'header',
				entries: [
					{
						cluster,
						landmark: {
							type: 'header',
							presenceRate: 1,
							chromeRate: 0.98,
							memberCountWithInstance: 42,
							shellTokens: [],
							shellTokenCount: 0,
						},
					},
				],
			},
			{
				type: 'footer',
				entries: [
					{
						cluster,
						landmark: {
							type: 'footer',
							presenceRate: 0.9,
							chromeRate: 0.8,
							memberCountWithInstance: 38,
							shellTokens: [],
							shellTokenCount: 0,
						},
					},
				],
			},
		],
	},
};
