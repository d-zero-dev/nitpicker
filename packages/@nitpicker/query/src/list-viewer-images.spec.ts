import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listImages } from './list-images.js';
import { listViewerImages } from './list-viewer-images.js';
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

/**
 * Builds a minimal `setPage` `meta` payload with every field null/false
 * except `title`.
 * @param title - The page title to embed.
 * @returns The `meta` payload.
 */
function pageMeta(title: string) {
	return {
		lang: null,
		title,
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
}

describe('listViewerImages', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_list_viewer_images__');
	const archiveFilePath = path.resolve(workingDir, 'list-viewer-images-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		// Page order (URL-ascending): /page-a, /page-b — drives the default
		// pageUrl sort's page_url_rank.
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
			meta: pageMeta('Page A'),
			anchorList: [],
			imageList: [
				{
					src: 'https://example.com/a1.png',
					currentSrc: 'https://example.com/a1-current.png',
					alt: 'A1',
					width: 100,
					height: 100,
					naturalWidth: 100,
					naturalHeight: 100,
					isLazy: true,
					viewportWidth: 1200,
					sourceCode: '<img src="a1.png" alt="A1">',
				},
				{
					src: 'https://example.com/a2.png',
					currentSrc: 'https://example.com/a2.png',
					alt: '',
					width: 300,
					height: 300,
					naturalWidth: 300,
					naturalHeight: 300,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="a2.png">',
				},
			],
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
			meta: pageMeta('Page B'),
			anchorList: [],
			imageList: [
				{
					src: 'https://example.com/b1.png',
					currentSrc: 'https://example.com/b1.png',
					alt: 'B1',
					width: 0,
					height: 0,
					naturalWidth: 5000,
					naturalHeight: 200,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="b1.png" alt="B1">',
				},
			],
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

	it('returns every image in page-url-ascending order by default', async () => {
		const result = await listViewerImages(archive, { limit: 100 });
		expect(result.items.map((i) => i.src)).toEqual([
			'https://example.com/a1.png',
			'https://example.com/a2.png',
			'https://example.com/b1.png',
		]);
		expect(result.total).toBe(3);
		expect(result.nextCursor).toBeNull();
		expect(result.prevCursor).toBeNull();
	});

	it('keeps src and currentSrc distinct, matching the live result', async () => {
		const [viewerResult, liveResult] = await Promise.all([
			listViewerImages(archive, { limit: 100 }),
			listImages(archive, { limit: 100 }),
		]);
		const viewerBySrc = new Map(viewerResult.items.map((i) => [i.src, i]));
		const liveBySrc = new Map(liveResult.items.map((i) => [i.src, i]));
		for (const src of viewerBySrc.keys()) {
			expect(viewerBySrc.get(src)?.currentSrc).toBe(liveBySrc.get(src)?.currentSrc);
		}
		expect(viewerBySrc.get('https://example.com/a1.png')?.currentSrc).toBe(
			'https://example.com/a1-current.png',
		);
	});

	it('filters by missingAlt', async () => {
		const result = await listViewerImages(archive, { missingAlt: true, limit: 100 });
		expect(result.items.map((i) => i.src)).toEqual(['https://example.com/a2.png']);
	});

	it('treats missingAlt: false as "has alt", agreeing with the live listImages path — regression test for a fast-path/live divergence', async () => {
		const [viewerResult, liveResult] = await Promise.all([
			listViewerImages(archive, { missingAlt: false, limit: 100 }),
			listImages(archive, { missingAlt: false, limit: 100 }),
		]);
		expect(viewerResult.items.map((i) => i.src).toSorted()).toEqual(
			liveResult.items.map((i) => i.src).toSorted(),
		);
		expect(viewerResult.total).toBe(2);
	});

	it('treats missingDimensions: false as "has dimensions", agreeing with the live listImages path', async () => {
		const [viewerResult, liveResult] = await Promise.all([
			listViewerImages(archive, { missingDimensions: false, limit: 100 }),
			listImages(archive, { missingDimensions: false, limit: 100 }),
		]);
		expect(viewerResult.items.map((i) => i.src).toSorted()).toEqual(
			liveResult.items.map((i) => i.src).toSorted(),
		);
	});

	it('filters by missingDimensions', async () => {
		const result = await listViewerImages(archive, {
			missingDimensions: true,
			limit: 100,
		});
		expect(result.items.map((i) => i.src)).toEqual(['https://example.com/b1.png']);
	});

	it('filters by an arbitrary oversizedThreshold at request time', async () => {
		const strict = await listViewerImages(archive, {
			oversizedThreshold: 1000,
			limit: 100,
		});
		expect(strict.items.map((i) => i.src)).toEqual(['https://example.com/b1.png']);

		const lenient = await listViewerImages(archive, {
			oversizedThreshold: 10_000,
			limit: 100,
		});
		expect(lenient.total).toBe(0);
	});

	it('sorts by width ascending', async () => {
		const result = await listViewerImages(archive, {
			sortBy: 'width',
			sortOrder: 'asc',
			limit: 100,
		});
		expect(result.items.map((i) => i.width)).toEqual([0, 100, 300]);
	});

	it('sorts by naturalWidth descending', async () => {
		const result = await listViewerImages(archive, {
			sortBy: 'naturalWidth',
			sortOrder: 'desc',
			limit: 100,
		});
		expect(result.items[0]?.naturalWidth).toBe(5000);
	});

	it('rejects a cursor minted under a different filter combination', async () => {
		const page1 = await listViewerImages(archive, { limit: 2 });
		await expect(
			listViewerImages(archive, {
				limit: 2,
				cursor: page1.nextCursor!,
				missingAlt: true,
			}),
		).rejects.toThrow(/does not match/);
	});

	it('paginates forward with keyset cursors, no gaps or overlaps', async () => {
		const page1 = await listViewerImages(archive, { limit: 2 });
		expect(page1.items.map((i) => i.src)).toEqual([
			'https://example.com/a1.png',
			'https://example.com/a2.png',
		]);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await listViewerImages(archive, {
			limit: 2,
			cursor: page1.nextCursor!,
		});
		expect(page2.items.map((i) => i.src)).toEqual(['https://example.com/b1.png']);
		expect(page2.nextCursor).toBeNull();
		expect(page2.prevCursor).not.toBeNull();
	});

	it('prevCursor navigates back to the exact previous page', async () => {
		const page1 = await listViewerImages(archive, { limit: 2 });
		const page2 = await listViewerImages(archive, {
			limit: 2,
			cursor: page1.nextCursor!,
		});
		const backToPage1 = await listViewerImages(archive, {
			limit: 2,
			cursor: page2.prevCursor!,
			direction: 'prev',
		});
		expect(backToPage1.items.map((i) => i.src)).toEqual(page1.items.map((i) => i.src));
	});

	it('supports direct offset reads for page-number jumps', async () => {
		const result = await listViewerImages(archive, { limit: 2, offset: 1 });
		expect(result.items.map((i) => i.src)).toEqual([
			'https://example.com/a2.png',
			'https://example.com/b1.png',
		]);
		expect(result.prevCursor).not.toBeNull();
	});
});
