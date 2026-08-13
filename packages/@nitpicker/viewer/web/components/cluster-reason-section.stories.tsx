import type { TemplateClusterSummary } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';

import { ClusterReasonSection } from './cluster-reason-section.js';

const meta = {
	component: ClusterReasonSection,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof ClusterReasonSection>;

export default meta;
type Story = StoryObj<typeof meta>;

const clusterWithReason: TemplateClusterSummary = {
	templateKey: '["css:166e4235afcb8b15","cluster:0"]',
	pageCount: 42,
	commonDirectories: [{ directory: '/products/', pageCount: 42 }],
	commonStylesheetUrls: ['https://example.test/assets/site.css'],
	commonStylesheetFileNames: ['site.css'],
	reason: {
		clusteredMemberCount: 40,
		blocking: [
			{
				blockKey: 'css:166e4235afcb8b15',
				reason: { kind: 'css', distinctiveStylesheetHrefs: ['/assets/product.css'] },
			},
		],
		distinctiveStylesheetUrls: ['https://example.test/assets/product.css'],
		distinctiveStylesheetFileNames: ['product.css'],
		structuralCoreTokens: ['html>body>header', 'html>body>main'],
		structuralCoreTokenCount: 5,
		landmarks: [
			{
				type: 'header',
				presenceRate: 1,
				chromeRate: 0.98,
				memberCountWithInstance: 42,
				shellTokens: ['header>nav'],
				shellTokenCount: 1,
			},
		],
		siblingClusterKeys: ['["css:166e4235afcb8b15","cluster:1"]'],
	},
};

/** A cluster with full cluster-selection evidence. */
export const WithReason: Story = { args: { cluster: clusterWithReason } };

/** A cluster classified without a captured reason (pre-cluster-reason archive, etc.). */
export const NoReason: Story = {
	args: { cluster: { ...clusterWithReason, reason: null } },
};
