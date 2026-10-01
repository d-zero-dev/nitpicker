import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';

import { TemplateClusterSummaryPanel } from './template-cluster-summary-panel.js';

const meta = {
	component: TemplateClusterSummaryPanel,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof TemplateClusterSummaryPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A typical overview with several clusters and landmark aggregates. */
export const Default: Story = {
	args: {
		overview: {
			clusterCount: 12,
			totalPageCount: 340,
			singletonClusterCount: 4,
			topClusters: [
				{
					templateKey: '["css:166e4235afcb8b15","cluster:0"]',
					pageCount: 210,
					commonDirectories: [{ directory: '/products/', pageCount: 210 }],
					commonStylesheetUrls: [],
					commonStylesheetFileNames: ['product.css'],
					reason: null,
				},
				{
					templateKey: '["path:0"]',
					pageCount: 80,
					commonDirectories: [{ directory: '/blog/', pageCount: 80 }],
					commonStylesheetUrls: [],
					commonStylesheetFileNames: [],
					reason: null,
				},
			],
			sizeBuckets: [
				{ key: 'single', clusterCount: 4, pageCount: 4 },
				{ key: 'small', clusterCount: 4, pageCount: 14 },
				{ key: 'medium', clusterCount: 2, pageCount: 32 },
				{ key: 'large', clusterCount: 2, pageCount: 290 },
			],
			landmarks: [
				{ type: 'header', clusterCount: 12, averagePresenceRate: 0.99 },
				{ type: 'footer', clusterCount: 11, averagePresenceRate: 0.95 },
				{ type: 'nav', clusterCount: 9, averagePresenceRate: 0.7 },
			],
		},
	},
};
