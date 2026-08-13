import type { Meta, StoryObj } from '@storybook/react-vite';

import { MemoryRouter } from 'react-router';

import { buildDemoPageDetail } from './demo-page-detail-fixtures.js';
import { PageMetadataGrid } from './page-metadata-grid.js';

const meta = {
	component: PageMetadataGrid,
	decorators: [
		(Story) => (
			<MemoryRouter>
				<Story />
			</MemoryRouter>
		),
	],
} satisfies Meta<typeof PageMetadataGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A typical crawled page with common metadata populated. */
export const Default: Story = { args: { data: buildDemoPageDetail() } };

/** A page captured by `--dedupe-cap`: the shape key links to the Crawl Suppression view. */
export const WithDedupeCap: Story = {
	args: {
		data: buildDemoPageDetail({
			isDedupeCapped: true,
			dedupeCapEventId: 7,
			dedupeCapShapeKey: '/blog/{id}',
		}),
	},
};

/** A skipped URL (robots.txt / excludeUrls / excludeKeywords): most fields are unpopulated. */
export const Skipped: Story = {
	args: {
		data: buildDemoPageDetail({
			isSkipped: true,
			skipReason: 'excludeUrls',
			status: null,
			statusText: null,
			contentType: null,
			title: null,
		}),
	},
};

/**
 * Every conditionally-rendered row populated at once: og:image:alt, og:locale,
 * og:article:published_time, twitter:site/creator, charset, manifest,
 * theme-color, Wappalyzer tags, and JSON-LD.
 */
export const FullMetadata: Story = {
	args: {
		data: buildDemoPageDetail({
			ogImageAlt: 'A screenshot of the homepage',
			ogLocale: 'en_US',
			ogArticlePublishedTime: '2024-01-01T00:00:00Z',
			twitterSite: '@example',
			twitterCreator: '@exampleAuthor',
			charset: 'utf8',
			manifest: 'https://example.com/manifest.json',
			themeColor: '#ffffff',
			tagCount: 3,
			tagsProvidersCsv: 'jquery,react',
			jsonldCount: 2,
			jsonLd: { count: 2, types: ['Article', 'BreadcrumbList'], parseErrorCount: 0 },
		}),
	},
};
