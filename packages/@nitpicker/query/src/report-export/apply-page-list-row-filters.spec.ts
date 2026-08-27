import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from '../viewer-read-model/build-viewer-read-model.js';

import { applyPageListRowFilters } from './apply-page-list-row-filters.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_apply_page_list_row_filters__',
);

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

describe('applyPageListRowFilters', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'apply-page-list-row-filters-test.nitpicker',
	);

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/blog')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/blogger')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/missing')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/file.pdf')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'application/pdf',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://external.example.com/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('keeps inner HTML pages, including 404s, and drops PDFs and externals', async () => {
		const rows: { path_sort_key: string }[] = await archive
			.getKnex()('viewer_pages')
			.modify((qb) => applyPageListRowFilters(qb, {}))
			.orderBy('path_sort_key', 'asc')
			.select('path_sort_key');
		expect(rows.map((row) => row.path_sort_key)).toEqual([
			'/blog',
			'/blogger',
			'/missing',
		]);
	});

	it('matches a directory on the path boundary, not as a string prefix', async () => {
		const rows: { path_sort_key: string }[] = await archive
			.getKnex()('viewer_pages')
			.modify((qb) => applyPageListRowFilters(qb, { directories: ['/blog'] }))
			.select('path_sort_key');
		expect(rows.map((row) => row.path_sort_key)).toEqual(['/blog']);
	});

	it('unions several directory prefixes', async () => {
		const rows: { path_sort_key: string }[] = await archive
			.getKnex()('viewer_pages')
			.modify((qb) => applyPageListRowFilters(qb, { directories: ['/blog', '/missing'] }))
			.orderBy('path_sort_key', 'asc')
			.select('path_sort_key');
		expect(rows.map((row) => row.path_sort_key)).toEqual(['/blog', '/missing']);
	});

	it('treats the site root as no directory restriction', async () => {
		const rooted: { path_sort_key: string }[] = await archive
			.getKnex()('viewer_pages')
			.modify((qb) => applyPageListRowFilters(qb, { directories: ['/'] }))
			.orderBy('path_sort_key', 'asc')
			.select('path_sort_key');
		expect(rooted.map((row) => row.path_sort_key)).toEqual([
			'/blog',
			'/blogger',
			'/missing',
		]);
	});

	it('rejects a blank directory filter', () => {
		const qb = archive.getKnex()('viewer_pages');
		expect(() => applyPageListRowFilters(qb, { directories: [''] })).toThrow(TypeError);
	});
});
