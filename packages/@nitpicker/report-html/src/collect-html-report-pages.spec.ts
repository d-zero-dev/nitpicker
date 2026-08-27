import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { collectHtmlReportPages } from './collect-html-report-pages.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_collect_html_report_pages__');

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.13.0',
	recursive: true,
	interval: 0,
	image: true,
	fetchExternal: false,
	parallels: 1,
	roots: ['https://example.com'],
	excludes: [],
	excludeKeywords: [],
	excludeUrls: [],
	maxExcludedDepth: 0,
	retry: 3,
	fromList: false,
	disableQueries: false,
	userAgent: 'test',
	ignoreRobots: false,
};

const META = {
	lang: null,
	title: null,
	description: null,
	keywords: null,
	noindex: false,
	nofollow: false,
	noarchive: false,
	canonical: null,
	alternate: null,
	'og:type': null,
	'og:title': null,
	'og:site_name': null,
	'og:description': null,
	'og:url': null,
	'og:image': null,
	'twitter:card': null,
};

describe('collectHtmlReportPages', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'collect-html-report-pages-test.nitpicker',
	);

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/docs')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Docs', description: 'Docs page' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/about')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'About' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setRedirect({
			url: parseUrl('https://example.com/old-docs')!,
			redirectPaths: ['https://example.com/docs'],
			isExternal: false,
			isTarget: true,
			status: 301,
			statusText: 'Moved Permanently',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setResources({
			url: parseUrl('https://example.com/ok.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 1000,
			compress: false,
			cdn: false,
			headers: null,
		});
		await archive.setResources({
			url: parseUrl('https://example.com/missing.png')!,
			isExternal: false,
			isError: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'image/png',
			contentLength: 0,
			compress: false,
			cdn: false,
			headers: null,
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/docs',
			src: 'https://example.com/ok.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/docs',
			src: 'https://example.com/missing.png',
		});

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('joins redirect sources and resource tallies onto inner pages in URL order', async () => {
		const pages = await collectHtmlReportPages(archive);
		expect(pages.map((page) => page.url)).toEqual([
			'https://example.com/about',
			'https://example.com/docs',
		]);
		expect(pages[1]).toMatchObject({
			title: 'Docs',
			status: 200,
			redirectChain: ['https://example.com/old-docs'],
			metaDescription: 'Docs page',
			resourceFilesExists: 1,
			resourceFilesTotal: 2,
		});
		expect(pages[0]?.resourceFilesTotal).toBe(0);
	});

	it('applies a directory prefix to the table rows only', async () => {
		const pages = await collectHtmlReportPages(archive, ['/docs']);
		expect(pages.map((page) => page.url)).toEqual(['https://example.com/docs']);
	});
});
