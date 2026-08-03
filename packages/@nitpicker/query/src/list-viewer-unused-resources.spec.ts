import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listUnusedResources } from './list-unused-resources.js';
import { listViewerUnusedResources } from './list-viewer-unused-resources.js';
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

describe('listViewerUnusedResources', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_viewer_unused_resources__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'list-viewer-unused-resources-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		// Internal, unreferenced — appears in the unused set.
		await archive.setResources({
			url: parseUrl('https://example.com/orphan-a.pdf')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/pdf',
			contentLength: 1000,
			compress: false,
			cdn: false,
			headers: {},
		});
		await archive.setResources({
			url: parseUrl('https://example.com/orphan-b.png')!,
			isExternal: false,
			isError: false,
			status: 404,
			statusText: 'Not Found',
			contentType: 'image/png',
			contentLength: 500,
			compress: false,
			cdn: false,
			headers: {},
		});
		await archive.setResources(
			{
				url: parseUrl('https://example.com/orphan-c.pdf')!,
				isExternal: false,
				isError: false,
				status: 200,
				statusText: 'OK',
				contentType: 'application/pdf',
				contentLength: 1500,
				compress: false,
				cdn: false,
				headers: {},
			},
			'inventory-seed',
		);

		// Referenced — must NOT appear.
		await archive.setResources({
			url: parseUrl('https://example.com/used.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 500,
			compress: false,
			cdn: false,
			headers: {},
		});
		await archive.setPage({
			url: parseUrl('https://example.com/page-using-css')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: {
				lang: null,
				title: 'Page with CSS',
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
			url: 'https://example.com/page-using-css',
			src: 'https://example.com/used.css',
		});

		// External, unreferenced — must NOT appear even though it has zero referrers.
		await archive.setResources({
			url: parseUrl('https://cdn.example.net/external.js')!,
			isExternal: true,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 200,
			compress: false,
			cdn: false,
			headers: {},
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

	it('matches listUnusedResources: internal + unreferenced only, excluding used and external', async () => {
		const [viewerResult, liveResult] = await Promise.all([
			listViewerUnusedResources(archive, { limit: 100 }),
			listUnusedResources(archive, { limit: 100 }),
		]);
		expect(viewerResult.items.map((i) => i.url).toSorted()).toEqual(
			liveResult.items.map((i) => i.url).toSorted(),
		);
		expect(viewerResult.total).toBe(3);
		const urls = viewerResult.items.map((i) => i.url);
		expect(urls).not.toContain('https://example.com/used.css');
		expect(urls).not.toContain('https://cdn.example.net/external.js');
	});

	it('returns the source badge from the DB column', async () => {
		const result = await listViewerUnusedResources(archive, { limit: 100 });
		const bySource = new Map(result.items.map((i) => [i.url, i.source]));
		expect(bySource.get('https://example.com/orphan-a.pdf')).toBe('crawled');
		expect(bySource.get('https://example.com/orphan-c.pdf')).toBe('inventory-seed');
	});

	it('filters by status', async () => {
		const result = await listViewerUnusedResources(archive, { status: 404, limit: 100 });
		expect(result.items.map((i) => i.url)).toEqual(['https://example.com/orphan-b.png']);
		expect(result.total).toBe(1);
	});

	it('rejects a cursor minted under a different status filter — regression test for a stale-cursor-across-status-change bug', async () => {
		const page1 = await listViewerUnusedResources(archive, { status: 200, limit: 1 });
		expect(page1.nextCursor).not.toBeNull();
		await expect(
			listViewerUnusedResources(archive, {
				status: 404,
				limit: 1,
				cursor: page1.nextCursor!,
			}),
		).rejects.toThrow(/does not match/);
	});

	it('filters by source', async () => {
		const result = await listViewerUnusedResources(archive, {
			source: 'inventory-seed',
			limit: 100,
		});
		expect(result.items.map((i) => i.url)).toEqual(['https://example.com/orphan-c.pdf']);
	});

	it('sorts by source, tie-broken by url', async () => {
		const result = await listViewerUnusedResources(archive, {
			sortBy: 'source',
			sortOrder: 'asc',
			limit: 100,
		});
		expect(result.items.map((i) => i.source)).toEqual([
			'crawled',
			'crawled',
			'inventory-seed',
		]);
	});

	it('paginates forward with keyset cursors', async () => {
		const page1 = await listViewerUnusedResources(archive, { limit: 2 });
		expect(page1.items).toHaveLength(2);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await listViewerUnusedResources(archive, {
			limit: 2,
			cursor: page1.nextCursor!,
		});
		expect(page2.items).toHaveLength(1);
		expect(page2.nextCursor).toBeNull();

		const allUrls = new Set([...page1.items, ...page2.items].map((i) => i.url));
		expect(allUrls.size).toBe(3);
	});
});
