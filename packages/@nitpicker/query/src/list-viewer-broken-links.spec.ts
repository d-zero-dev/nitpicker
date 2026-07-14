import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listViewerBrokenLinks } from './list-viewer-broken-links.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_viewer_broken_links__');

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

describe('listViewerBrokenLinks', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'list-viewer-broken-links-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
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
			meta: { ...META, title: 'Page A' },
			anchorList: [
				{
					href: parseUrl('https://example.com/broken-a')!,
					isExternal: false,
					title: null,
					textContent: 'Broken A',
				},
				{
					href: parseUrl('https://example.com/forbidden')!,
					isExternal: false,
					title: null,
					textContent: 'Forbidden',
				},
				{
					href: parseUrl('https://example.com/server-error')!,
					isExternal: false,
					title: null,
					textContent: 'Server error',
				},
				{
					href: parseUrl('https://example.com/never-fetched')!,
					isExternal: false,
					title: null,
					textContent: 'Never fetched',
				},
			],
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
			meta: { ...META, title: 'Page B' },
			anchorList: [
				{
					href: parseUrl('https://example.com/broken-b')!,
					isExternal: false,
					title: null,
					textContent: 'Broken B',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/broken-a')!,
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
			url: parseUrl('https://example.com/broken-b')!,
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
			url: parseUrl('https://example.com/forbidden')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 403,
			statusText: 'Forbidden',
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
			url: parseUrl('https://example.com/server-error')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 500,
			statusText: 'Internal Server Error',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		// No `setPage` call for https://example.com/never-fetched: the anchor
		// on page-a above already caused the crawler to insert a discovery
		// placeholder row for it (scraped=0, status=NULL) — matching
		// list-links.ts's scope note that such rows must never satisfy
		// `status = 404`.

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

	it('returns only 404 destinations, excluding 403/5xx/never-fetched', async () => {
		const result = await listViewerBrokenLinks(archive);
		expect(result.items.map((item) => item.destUrl).toSorted()).toEqual([
			'https://example.com/broken-a',
			'https://example.com/broken-b',
		]);
		expect(result.total).toBe(2);
	});

	it('reports source, dest, and status but always null textContent (not stored in the fast path)', async () => {
		const result = await listViewerBrokenLinks(archive, { sortBy: 'destUrl' });
		expect(result.items[0]).toMatchObject({
			sourceUrl: 'https://example.com/page-a',
			destUrl: 'https://example.com/broken-a',
			status: 404,
			isExternal: false,
			textContent: null,
		});
	});

	it('filters by status (broken links are always 404, so a non-404 filter matches nothing)', async () => {
		const matching = await listViewerBrokenLinks(archive, { status: 404 });
		expect(matching.total).toBe(2);
		const nonMatching = await listViewerBrokenLinks(archive, { status: 500 });
		expect(nonMatching.total).toBe(0);
	});

	it('sorts by destUrl ascending', async () => {
		const result = await listViewerBrokenLinks(archive, {
			sortBy: 'destUrl',
			sortOrder: 'asc',
		});
		expect(result.items.map((item) => item.destUrl)).toEqual([
			'https://example.com/broken-a',
			'https://example.com/broken-b',
		]);
	});

	it('status ties (every broken link is 404) still paginate without duplicates or gaps, in both directions', async () => {
		// Every row here has the exact same status_sort_key/status_desc_key —
		// this is what the source_url_ref_id tie-breaker in the keyset
		// tuple exists to disambiguate.
		const [pageAsc0, pageAsc1] = await Promise.all([
			listViewerBrokenLinks(archive, {
				sortBy: 'status',
				sortOrder: 'asc',
				limit: 1,
				offset: 0,
			}),
			listViewerBrokenLinks(archive, {
				sortBy: 'status',
				sortOrder: 'asc',
				limit: 1,
				offset: 1,
			}),
		]);
		expect([pageAsc0.items[0]!.destUrl, pageAsc1.items[0]!.destUrl].toSorted()).toEqual([
			'https://example.com/broken-a',
			'https://example.com/broken-b',
		]);

		const [pageDesc0, pageDesc1] = await Promise.all([
			listViewerBrokenLinks(archive, {
				sortBy: 'status',
				sortOrder: 'desc',
				limit: 1,
				offset: 0,
			}),
			listViewerBrokenLinks(archive, {
				sortBy: 'status',
				sortOrder: 'desc',
				limit: 1,
				offset: 1,
			}),
		]);
		expect([pageDesc0.items[0]!.destUrl, pageDesc1.items[0]!.destUrl].toSorted()).toEqual(
			['https://example.com/broken-a', 'https://example.com/broken-b'],
		);
	});

	it('paginates forward via nextCursor with no duplicates or gaps', async () => {
		const page1 = await listViewerBrokenLinks(archive, { sortBy: 'destUrl', limit: 1 });
		expect(page1.items).toHaveLength(1);
		expect(page1.nextCursor).not.toBeNull();
		expect(page1.prevCursor).toBeNull();

		const page2 = await listViewerBrokenLinks(archive, {
			sortBy: 'destUrl',
			limit: 1,
			cursor: page1.nextCursor!,
		});
		expect(page2.items).toHaveLength(1);
		expect(page2.nextCursor).toBeNull();
		expect(page2.prevCursor).not.toBeNull();

		expect([...page1.items, ...page2.items].map((item) => item.destUrl)).toEqual([
			'https://example.com/broken-a',
			'https://example.com/broken-b',
		]);
	});

	it('walks backward from a forward cursor via direction: "prev" and restores the same page', async () => {
		const page1 = await listViewerBrokenLinks(archive, { sortBy: 'destUrl', limit: 1 });
		const page2 = await listViewerBrokenLinks(archive, {
			sortBy: 'destUrl',
			limit: 1,
			cursor: page1.nextCursor!,
		});
		const back = await listViewerBrokenLinks(archive, {
			sortBy: 'destUrl',
			limit: 1,
			cursor: page2.prevCursor!,
			direction: 'prev',
		});
		expect(back.items).toEqual(page1.items);
	});

	it('supports a direct offset read for MPA page-number jumps', async () => {
		const result = await listViewerBrokenLinks(archive, {
			sortBy: 'destUrl',
			limit: 1,
			offset: 1,
		});
		expect(result.items).toHaveLength(1);
		expect(result.items[0]!.destUrl).toBe('https://example.com/broken-b');
	});

	it('throws on a cursor minted under a different sort/filter combination', async () => {
		const page1 = await listViewerBrokenLinks(archive, { sortBy: 'destUrl', limit: 1 });
		await expect(
			listViewerBrokenLinks(archive, {
				sortBy: 'sourceUrl',
				limit: 1,
				cursor: page1.nextCursor!,
			}),
		).rejects.toThrow(/does not match/);
	});
});

/**
 * Mirrors `list-links.spec.ts`'s redirect-resolution coverage: a broken
 * anchor reached both directly and via an internal redirect source must
 * collapse into separate edge rows (one per distinct referring page) that
 * both report the canonical (post-redirect) destination and status.
 */
describe('listViewerBrokenLinks — redirect resolution', () => {
	const redirectWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_viewer_broken_links_redirect__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		redirectWorkingDir,
		'list-viewer-broken-links-redirect-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(redirectWorkingDir, { recursive: true });
		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: redirectWorkingDir,
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

		await archive.setPage({
			url: parseUrl('https://example.com/direct')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Direct' },
			anchorList: [
				{
					href: parseUrl('https://example.com/canonical-target')!,
					isExternal: false,
					title: null,
					textContent: 'Direct link',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/via-redirect')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Via redirect' },
			anchorList: [
				{
					href: parseUrl('https://example.com/old')!,
					isExternal: false,
					title: null,
					textContent: 'Old link',
					hash: null,
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/canonical-target')!,
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
		await archive.setRedirect({
			url: parseUrl('https://example.com/old')!,
			redirectPaths: ['https://example.com/canonical-target'],
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

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(redirectWorkingDir, { recursive: true, force: true });
	});

	it('reports the canonical destination for both the direct and redirect-source-routed anchors', async () => {
		const result = await listViewerBrokenLinks(archive, { sortBy: 'sourceUrl' });
		expect(result.items).toHaveLength(2);
		for (const item of result.items) {
			expect(item).toMatchObject({
				destUrl: 'https://example.com/canonical-target',
				status: 404,
			});
		}
		expect(result.items.map((item) => item.sourceUrl).toSorted()).toEqual([
			'https://example.com/direct',
			'https://example.com/via-redirect',
		]);
	});
});

/**
 * A broken link and an external link are independent judgments on the same
 * `viewer_anchor_facts` row (`is_broken`/`is_external_link` are separate
 * flags) — a destination can be both. Isolated into its own archive so it
 * doesn't perturb the main describe block's exact item/pagination counts.
 */
describe('listViewerBrokenLinks — a destination that is both broken and external', () => {
	const brokenExternalWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_viewer_broken_links_broken_external__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		brokenExternalWorkingDir,
		'list-viewer-broken-links-broken-external-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(brokenExternalWorkingDir, { recursive: true });
		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: brokenExternalWorkingDir,
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
			meta: { ...META, title: 'Page A' },
			anchorList: [
				{
					href: parseUrl('https://external.example.com/broken-ext')!,
					isExternal: true,
					title: null,
					textContent: 'Broken external',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://external.example.com/broken-ext')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
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

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(brokenExternalWorkingDir, { recursive: true, force: true });
	});

	it('reports isExternal: true for a broken destination that is also external', async () => {
		const result = await listViewerBrokenLinks(archive);
		expect(result.items).toEqual([
			expect.objectContaining({
				sourceUrl: 'https://example.com/page-a',
				destUrl: 'https://external.example.com/broken-ext',
				status: 404,
				isExternal: true,
			}),
		]);
	});
});
