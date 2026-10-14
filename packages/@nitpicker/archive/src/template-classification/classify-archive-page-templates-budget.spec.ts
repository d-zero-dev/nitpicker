import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import Archive from '../archive.js';

import { classifyArchivePageTemplates } from './classify-archive-page-templates.js';

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_classify_archive_page_templates_budget__',
);

const baseMeta = {
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
} as const;

const ARTICLE = `<html><body><main><article><h1>A</h1><p>Body text</p></article></main></body></html>`;

/** Pages of the one section: one more than the 100 a sampled block keeps. */
const PAGE_COUNT = 101;

describe('classifyArchivePageTemplates (memory budget)', () => {
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'classify-archive-budget.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig({
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
		});
		for (let index = 0; index < PAGE_COUNT; index++) {
			await archive.setPage({
				url: parseUrl(`https://example.com/news/${index}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: ARTICLE.length,
				responseHeaders: {},
				html: ARTICLE,
				meta: baseMeta,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}
	}, 60_000);

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('clusters every page of the block whole under the default budget', async () => {
		const result = await classifyArchivePageTemplates(archive);

		expect(result).toEqual({
			classifiedPageCount: 101,
			templateCount: 1,
			sampledBlocks: [],
		});
	});

	it('hands the budget to the classifier: a budget of zero samples the block and reports it', async () => {
		const result = await classifyArchivePageTemplates(archive, { memoryBudget: 0 });

		expect(result).toEqual({
			classifiedPageCount: 101,
			templateCount: 1,
			sampledBlocks: [
				{
					blockKey: 'path:news',
					pageCount: 101,
					pairBytes: 40_400,
					reason: 'table-over-budget',
				},
			],
		});
	});

	it('reports the sampled block through the progress events too', async () => {
		const phases: string[] = [];
		await classifyArchivePageTemplates(archive, {
			memoryBudget: 40_399,
			onProgress: (event) => phases.push(event.phase),
		});

		expect(phases).toContain('block-sampled');
	});
});
