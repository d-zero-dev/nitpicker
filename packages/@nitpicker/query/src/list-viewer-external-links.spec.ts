import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listViewerExternalLinks } from './list-viewer-external-links.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_list_viewer_external_links__',
);

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

/**
 * Mirrors `list-external-links.spec.ts`'s fixture and test cases, but
 * against `listViewerExternalLinks` (the `viewer_external_links` read-model
 * fast path) after `buildViewerReadModel` has populated the table — pinning
 * that both backends agree on filter/sort/pagination/tie-break behavior.
 */
describe('listViewerExternalLinks', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'list-viewer-external-links-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.10.0',
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

		// Page A: two anchors to ads.example.com (same page, must count as one
		// referrer, not two), plus one to tracking, one to solo.
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
					href: parseUrl('https://ads.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Ad banner',
				},
				{
					href: parseUrl('https://ads.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Ad footer',
				},
				{
					href: parseUrl('https://tracking.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Tracking',
				},
				{
					href: parseUrl('https://solo.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Solo',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// Page B: anchors to ads.example.com (2nd distinct referrer) and tracking.
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
					href: parseUrl('https://ads.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Ad sidebar',
				},
				{
					href: parseUrl('https://tracking.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Tracking again',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// Page C: anchor to ads.example.com (3rd distinct referrer).
		await archive.setPage({
			url: parseUrl('https://example.com/page-c')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Page C' },
			anchorList: [
				{
					href: parseUrl('https://ads.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Ad again',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// External destination rows. ads/solo resolve 200; tracking resolves 404.
		await archive.setPage({
			url: parseUrl('https://ads.example.com/')!,
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
		await archive.setPage({
			url: parseUrl('https://tracking.example.com/')!,
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
		await archive.setPage({
			url: parseUrl('https://solo.example.com/')!,
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
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('宛先を1つの行に集約し、参照元ページ数を返す', async () => {
		const result = await listViewerExternalLinks(archive);
		const ads = result.items.find((item) => item.destUrl === 'https://ads.example.com');
		expect(ads).toBeDefined();
		expect(ads!.referrerCount).toBe(3);
	});

	it('総件数はアンカー数ではなく宛先の異なり数になる', async () => {
		const result = await listViewerExternalLinks(archive);
		expect(result.total).toBe(3);
		expect(result.items).toHaveLength(3);
	});

	it('status で宛先をフィルタする', async () => {
		const result = await listViewerExternalLinks(archive, { status: 404 });
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			destUrl: 'https://tracking.example.com',
			status: 404,
			referrerCount: 2,
		});
	});

	it('urlPattern は宛先URLのみを対象にする（リンク元URLにはマッチしない）', async () => {
		const matching = await listViewerExternalLinks(archive, { urlPattern: '%ads%' });
		expect(matching.items).toHaveLength(1);
		expect(matching.items[0]!.destUrl).toBe('https://ads.example.com');

		const sourceOnly = await listViewerExternalLinks(archive, { urlPattern: '%page-a%' });
		expect(sourceOnly.items).toHaveLength(0);
	});

	it('referrerCount の降順でソートできる', async () => {
		const result = await listViewerExternalLinks(archive, {
			sortBy: 'referrerCount',
			sortOrder: 'desc',
		});
		expect(result.items.map((item) => item.destUrl)).toEqual([
			'https://ads.example.com',
			'https://tracking.example.com',
			'https://solo.example.com',
		]);
	});

	it('ページネーションが機能する', async () => {
		const result = await listViewerExternalLinks(archive, {
			sortBy: 'referrerCount',
			sortOrder: 'desc',
			limit: 1,
			offset: 1,
		});
		expect(result.items).toHaveLength(1);
		expect(result.items[0]!.destUrl).toBe('https://tracking.example.com');
	});

	it('status でタイが発生してもページネーションで宛先が重複・欠落しない', async () => {
		// ads and solo both resolve to status 200 (a tie). Paginating one row at
		// a time must still cover every distinct destination exactly once —
		// this is what the dest_page_id tiebreaker in the ORDER BY clause
		// guarantees.
		const pages = await Promise.all([
			listViewerExternalLinks(archive, {
				sortBy: 'status',
				sortOrder: 'asc',
				limit: 1,
				offset: 0,
			}),
			listViewerExternalLinks(archive, {
				sortBy: 'status',
				sortOrder: 'asc',
				limit: 1,
				offset: 1,
			}),
			listViewerExternalLinks(archive, {
				sortBy: 'status',
				sortOrder: 'asc',
				limit: 1,
				offset: 2,
			}),
		]);
		const seen = pages.map((page) => page.items[0]!.destUrl).toSorted();
		expect(seen).toEqual([
			'https://ads.example.com',
			'https://solo.example.com',
			'https://tracking.example.com',
		]);
	});

	it('未知の sortBy 値では destUrl ソートにフォールバックする（例外を投げない）', async () => {
		const result = await listViewerExternalLinks(archive, {
			sortBy: 'sourceUrl' as unknown as 'destUrl',
		});
		expect(result.items.map((item) => item.destUrl)).toEqual([
			'https://ads.example.com',
			'https://solo.example.com',
			'https://tracking.example.com',
		]);
	});
});

/**
 * Mirrors `list-external-links.spec.ts`'s redirect-resolution describe
 * block for the fast path.
 */
describe('listViewerExternalLinks — redirect resolution', () => {
	let archive: InstanceType<typeof Archive>;
	const redirectWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_viewer_external_links_redirect__',
	);
	const redirectArchiveFilePath = path.resolve(
		redirectWorkingDir,
		'list-viewer-external-links-redirect-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(redirectWorkingDir, { recursive: true });
		archive = await Archive.create({
			filePath: redirectArchiveFilePath,
			cwd: redirectWorkingDir,
		});
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.10.0',
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
					href: parseUrl('https://redirect-target.example.com/')!,
					isExternal: true,
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
			url: parseUrl('https://redirect-target.example.com/')!,
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

		await archive.setRedirect({
			url: parseUrl('https://example.com/old')!,
			redirectPaths: ['https://redirect-target.example.com/'],
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

	it('リダイレクト元経由と直接リンクが同じ正規宛先に集約される', async () => {
		const result = await listViewerExternalLinks(archive);
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			destUrl: 'https://redirect-target.example.com',
			referrerCount: 2,
		});
	});
});
