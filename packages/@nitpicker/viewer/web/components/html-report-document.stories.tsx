import type { Meta, StoryObj } from '@storybook/react-vite';

import { HtmlReportDocument } from './html-report-document.js';

const meta = {
	component: HtmlReportDocument,
	parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof HtmlReportDocument>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		title: 'Nitpicker HTML Report',
		generatedAt: '2026-08-27 12:00 JST',
		locale: 'en',
		directoryPrefixes: ['/docs'],
		summary: {
			baseUrl: 'https://example.com/',
			roots: ['https://example.com/'],
			maxExcludedDepth: 0,
			excludeKeywords: [],
			excludes: [],
			excludeUrls: [],
			totalPages: 123,
			internalPages: 120,
			externalPages: 3,
			internalContents: 138,
			externalContents: 24,
			statusDistribution: [
				{ status: 200, count: 116 },
				{ status: 301, count: 4 },
				{ status: 404, count: 3 },
			],
			metadataFulfillment: {
				title: 0.98,
				description: 0.84,
				keywords: 0.2,
				ogTitle: 0.72,
				ogDescription: 0.68,
				ogImage: 0.61,
			},
			contentTypeDistribution: [
				{ category: 'html', internal: 120, external: 3 },
				{ category: 'image', internal: 18, external: 4 },
			],
			technologyDistribution: [
				{ technology: 'React', pageCount: 90 },
				{ technology: 'Vite', pageCount: 75 },
			],
			networkOutageAffectedFailures: 0,
			consoleLogCounts: { pageerror: 1, error: 2, warn: 3 },
		},
		pages: [
			{
				title: 'Home',
				url: 'https://example.com/',
				status: 200,
				redirectChain: [],
				metaDescription: 'Example home page',
				resourceFilesExists: 12,
				resourceFilesTotal: 13,
				consoleErrorCount: 0,
			},
			{
				title: 'Moved page',
				url: 'https://example.com/old',
				status: 301,
				redirectChain: ['https://example.com/old', 'https://example.com/new'],
				metaDescription: null,
				resourceFilesExists: 0,
				resourceFilesTotal: 0,
				consoleErrorCount: 1,
			},
			{
				title: 'Missing page',
				url: 'https://example.com/gone',
				status: 404,
				redirectChain: [],
				metaDescription: null,
				resourceFilesExists: 0,
				resourceFilesTotal: 2,
				consoleErrorCount: 3,
			},
		],
	},
};
