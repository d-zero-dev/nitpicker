import type { TemplateClusterSummary } from '@nitpicker/query';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';

import { TemplateClusterItem } from './template-cluster-item.js';

const meta = {
	component: TemplateClusterItem,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof TemplateClusterItem>;

export default meta;
type Story = StoryObj<typeof meta>;

const clusterWithReason: TemplateClusterSummary = {
	templateKey: '["css:166e4235afcb8b15","cluster:0"]',
	label: { section: 'products', ordinal: 1, provisional: false },
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

/** A cluster classified without any directories, stylesheets, or reason evidence. */
export const Minimal: Story = {
	args: {
		cluster: {
			templateKey: '["path:0"]',
			label: null,
			pageCount: 3,
			commonDirectories: [],
			commonStylesheetUrls: [],
			commonStylesheetFileNames: [],
			reason: null,
		},
	},
};

/**
 * No stored label: the heading is the derived identifiers (stylesheet file
 * names, then the sibling-disambiguating directory), each in `<code>`.
 */
export const UnlabelledWithStylesheets: Story = {
	args: {
		cluster: {
			...clusterWithReason,
			label: null,
			commonDirectories: [
				{ directory: 'https://example.test/products/', pageCount: 30 },
				{ directory: 'https://example.test/sale/', pageCount: 12 },
				{ directory: 'https://example.test/news/', pageCount: 6 },
				{ directory: 'https://example.test/docs/', pageCount: 4 },
			],
		},
	},
};
