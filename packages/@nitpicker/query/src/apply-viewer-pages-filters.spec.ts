import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyViewerPagesFilters } from './apply-viewer-pages-filters.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

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

describe('applyViewerPagesFilters', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_pages_filters__',
	);
	const archiveFilePath = path.resolve(workingDir, 'apply-filters-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/html-internal')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Home' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/doc.pdf')!,
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

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('defaults to the html/unknown content_category restriction when no category filter is given', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, {});
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/html-internal']);
	});

	it('relaxes the default restriction when an explicit contentTypeCategory is given', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { contentTypeCategory: 'pdf' });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/doc.pdf']);
	});

	it('filters by an array of contentTypeCategory values, OR-ing them together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { contentTypeCategory: ['html', 'pdf'] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/doc.pdf',
			'https://example.com/html-internal',
		]);
	});

	it('defaults to the html/unknown content_category restriction when contentTypeCategory is an empty array — regression test for a truthy-check-on-[] bug', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { contentTypeCategory: [] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/html-internal']);
	});

	it('filters by an array of statuses, OR-ing them together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { status: [200, 999] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/html-internal',
		]);
	});
});

describe('applyViewerPagesFilters — templateKey', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_pages_filters_template_key__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'apply-filters-template-key-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		for (const pagePath of ['/a', '/b', '/c']) {
			await archive.setPage({
				url: parseUrl(`https://example.com${pagePath}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}
		await archive.replacePageTemplates(
			new Map([
				['https://example.com/a', 'template-a'],
				['https://example.com/b', 'template-b'],
				['https://example.com/c', 'template-c'],
			]),
			new Map(),
		);

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('filters by an array of templateKey values, OR-ing them together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { templateKey: ['template-a', 'template-c'] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/a',
			'https://example.com/c',
		]);
	});

	it('applies no templateKey restriction when the array is empty — regression test for a truthy-check-on-[] bug', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { templateKey: [] });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/a',
			'https://example.com/b',
			'https://example.com/c',
		]);
	});
});

describe('applyViewerPagesFilters — directory', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_pages_filters_directory__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'apply-filters-directory-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		const pagePaths = [
			'/blog/2024/post-a',
			'/blog/2024/sub/post-b',
			// A sibling directory sharing `/blog` as a literal string prefix —
			// must NOT be matched by a `directory: '/blog/2024'` filter.
			'/blog2/post-c',
		];
		for (const pagePath of pagePaths) {
			await archive.setPage({
				url: parseUrl(`https://example.com${pagePath}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('matches a directory and its entire subtree, not a literal-prefix sibling', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { directory: '/blog/2024' });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/blog/2024/post-a',
			'https://example.com/blog/2024/sub/post-b',
		]);
	});

	it('treats a directory with or without a trailing slash the same', async () => {
		const knex = archive.getKnex();
		const qbNoSlash = knex('viewer_pages');
		applyViewerPagesFilters(qbNoSlash, { directory: '/blog/2024' });
		const qbWithSlash = knex('viewer_pages');
		applyViewerPagesFilters(qbWithSlash, { directory: '/blog/2024/' });

		const [rowsNoSlash, rowsWithSlash] = await Promise.all([
			qbNoSlash.select('url'),
			qbWithSlash.select('url'),
		]);
		expect(rowsNoSlash.map((r) => r.url).toSorted()).toEqual(
			rowsWithSlash.map((r) => r.url).toSorted(),
		);
	});
});
