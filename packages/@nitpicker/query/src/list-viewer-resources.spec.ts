import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listResources } from './list-resources.js';
import { listViewerResources } from './list-viewer-resources.js';
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

describe('listViewerResources', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_list_viewer_resources__');
	const archiveFilePath = path.resolve(
		workingDir,
		'list-viewer-resources-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		// 4 internal resources, url-ascending: a.css, b.js, c.png, d.pdf.
		await archive.setResources({
			url: parseUrl('https://example.com/a.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 100,
			compress: false,
			cdn: false,
			headers: {},
		});
		await archive.setResources({
			url: parseUrl('https://example.com/b.js')!,
			isExternal: false,
			isError: false,
			status: 404,
			statusText: 'Not Found',
			contentType: 'application/javascript',
			contentLength: 200,
			compress: 'gzip',
			cdn: false,
			headers: {},
		});
		await archive.setResources({
			url: parseUrl('https://example.com/c.png')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'image/png',
			contentLength: 300,
			compress: false,
			cdn: 'cloudflare',
			headers: {},
		});
		await archive.setResources({
			url: parseUrl('https://example.com/d.pdf')!,
			isExternal: false,
			isError: true,
			status: null,
			statusText: null,
			contentType: 'application/pdf',
			contentLength: null,
			compress: false,
			cdn: false,
			headers: {},
		});

		// External resource — visible via isExternal:true filter only.
		await archive.setResources({
			url: parseUrl('https://cdn.example.net/e.js')!,
			isExternal: true,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 400,
			compress: false,
			cdn: false,
			headers: {},
		});

		// Two referrers for a.css — must surface as referrerCount: 2.
		await archive.setPage({
			url: parseUrl('https://example.com/page-a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: {
				lang: null,
				title: 'Page A',
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/page-b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: {
				lang: null,
				title: 'Page B',
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/page-a',
			src: 'https://example.com/a.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/page-b',
			src: 'https://example.com/a.css',
		});

		await buildViewerReadModel(archive);
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns every resource (internal and external) in url-ascending order by default', async () => {
		const result = await listViewerResources(archive, { limit: 100 });
		expect(result.items.map((i) => i.url)).toEqual([
			'https://cdn.example.net/e.js',
			'https://example.com/a.css',
			'https://example.com/b.js',
			'https://example.com/c.png',
			'https://example.com/d.pdf',
		]);
		expect(result.total).toBe(5);
		expect(result.nextCursor).toBeNull();
		expect(result.prevCursor).toBeNull();
	});

	it('joins referrerCount from viewer_resource_stats, matching the legacy correlated-subquery result', async () => {
		const [viewerResult, legacyResult] = await Promise.all([
			listViewerResources(archive, { limit: 100 }),
			listResources(archive, { limit: 100 }),
		]);
		const viewerByUrl = new Map(viewerResult.items.map((i) => [i.url, i]));
		const legacyByUrl = new Map(legacyResult.items.map((i) => [i.url, i]));
		for (const url of viewerByUrl.keys()) {
			expect(viewerByUrl.get(url)?.referrerCount).toBe(
				legacyByUrl.get(url)?.referrerCount,
			);
		}
		expect(viewerByUrl.get('https://example.com/a.css')?.referrerCount).toBe(2);
		expect(viewerByUrl.get('https://example.com/b.js')?.referrerCount).toBe(0);
	});

	it('filters by isExternal', async () => {
		const result = await listViewerResources(archive, { isExternal: true, limit: 100 });
		expect(result.items.map((i) => i.url)).toEqual(['https://cdn.example.net/e.js']);
	});

	it('filters by exact status — regression test for a dropped status filter', async () => {
		const result = await listViewerResources(archive, { status: 404, limit: 100 });
		expect(result.items.map((i) => i.url)).toEqual(['https://example.com/b.js']);
		expect(result.total).toBe(1);
	});

	it('rejects a cursor minted under a different status filter', async () => {
		const page1 = await listViewerResources(archive, { status: 200, limit: 1 });
		await expect(
			listViewerResources(archive, {
				status: 404,
				limit: 1,
				cursor: page1.nextCursor!,
			}),
		).rejects.toThrow(/does not match/);
	});

	it('sorts by status ascending, with the null-status resource sorting first via the sentinel', async () => {
		const result = await listViewerResources(archive, {
			sortBy: 'status',
			sortOrder: 'asc',
			limit: 100,
		});
		expect(result.items[0]?.url).toBe('https://example.com/d.pdf');
		expect(result.items[0]?.status).toBeNull();
	});

	it('sorts by status descending', async () => {
		const result = await listViewerResources(archive, {
			sortBy: 'status',
			sortOrder: 'desc',
			limit: 100,
		});
		expect(result.items[0]?.status).toBe(404);
		expect(result.items.at(-1)?.status).toBeNull();
	});

	it('paginates forward with keyset cursors, no gaps or overlaps', async () => {
		const page1 = await listViewerResources(archive, { limit: 2 });
		expect(page1.items.map((i) => i.url)).toEqual([
			'https://cdn.example.net/e.js',
			'https://example.com/a.css',
		]);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await listViewerResources(archive, {
			limit: 2,
			cursor: page1.nextCursor!,
		});
		expect(page2.items.map((i) => i.url)).toEqual([
			'https://example.com/b.js',
			'https://example.com/c.png',
		]);
		expect(page2.nextCursor).not.toBeNull();
		expect(page2.prevCursor).not.toBeNull();

		const page3 = await listViewerResources(archive, {
			limit: 2,
			cursor: page2.nextCursor!,
		});
		expect(page3.items.map((i) => i.url)).toEqual(['https://example.com/d.pdf']);
		expect(page3.nextCursor).toBeNull();
	});

	it('prevCursor navigates back to the exact previous page', async () => {
		const page1 = await listViewerResources(archive, { limit: 2 });
		const page2 = await listViewerResources(archive, {
			limit: 2,
			cursor: page1.nextCursor!,
		});
		const backToPage1 = await listViewerResources(archive, {
			limit: 2,
			cursor: page2.prevCursor!,
			direction: 'prev',
		});
		expect(backToPage1.items.map((i) => i.url)).toEqual(page1.items.map((i) => i.url));
	});

	it('supports direct offset reads for page-number jumps', async () => {
		const result = await listViewerResources(archive, { limit: 2, offset: 2 });
		expect(result.items.map((i) => i.url)).toEqual([
			'https://example.com/b.js',
			'https://example.com/c.png',
		]);
		expect(result.prevCursor).not.toBeNull();
	});

	it('rejects a cursor minted under a different filter combination', async () => {
		const page1 = await listViewerResources(archive, { limit: 2 });
		await expect(
			listViewerResources(archive, {
				limit: 2,
				cursor: page1.nextCursor!,
				isExternal: true,
			}),
		).rejects.toThrow(/does not match/);
	});
});
