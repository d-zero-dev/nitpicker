import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { populateMigrationTables } from './__test-utils__/populate-migration-tables.js';
import { listExternalLinks } from './list-external-links.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_external_links__');

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

describe('listExternalLinks', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'list-external-links-test.nitpicker');

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
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('宛先を1つの行に集約し、参照元ページ数を返す', async () => {
		const result = await listExternalLinks(archive);
		const ads = result.items.find((item) => item.destUrl === 'https://ads.example.com');
		expect(ads).toBeDefined();
		expect(ads!.referrerCount).toBe(3);
	});

	it('同一ページからの複数アンカーは参照元1件として数える', async () => {
		// Page A has two <a> tags to ads.example.com; combined with page B and
		// page C that's 3 distinct referring pages, NOT 4 anchors.
		const result = await listExternalLinks(archive);
		const ads = result.items.find((item) => item.destUrl === 'https://ads.example.com');
		expect(ads!.referrerCount).toBe(3);
	});

	it('総件数はアンカー数ではなく宛先の異なり数になる', async () => {
		// 7 anchors total point at external destinations (4 from page-a + 2
		// from page-b + 1 from page-c), but only 3 distinct destinations.
		const result = await listExternalLinks(archive);
		expect(result.total).toBe(3);
		expect(result.items).toHaveLength(3);
	});

	it('status で宛先をフィルタする', async () => {
		const result = await listExternalLinks(archive, { status: 404 });
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			destUrl: 'https://tracking.example.com',
			status: 404,
			referrerCount: 2,
		});
	});

	it('urlPattern は宛先URLのみを対象にする（リンク元URLにはマッチしない）', async () => {
		const matching = await listExternalLinks(archive, { urlPattern: '%ads%' });
		expect(matching.items).toHaveLength(1);
		expect(matching.items[0]!.destUrl).toBe('https://ads.example.com');

		const sourceOnly = await listExternalLinks(archive, { urlPattern: '%page-a%' });
		expect(sourceOnly.items).toHaveLength(0);
	});

	it('referrerCount の降順でソートできる', async () => {
		const result = await listExternalLinks(archive, {
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
		const result = await listExternalLinks(archive, {
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
		// this is what the destId tiebreaker in the ORDER BY clause guarantees.
		const pages = await Promise.all([
			listExternalLinks(archive, {
				sortBy: 'status',
				sortOrder: 'asc',
				limit: 1,
				offset: 0,
			}),
			listExternalLinks(archive, {
				sortBy: 'status',
				sortOrder: 'asc',
				limit: 1,
				offset: 1,
			}),
			listExternalLinks(archive, {
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
});

/**
 * Separate describe with a dedicated fixture: one anchor targets an internal
 * redirect-source page whose canonical destination is the same external URL
 * that another anchor links to directly. Pins that both collapse into a
 * single destination row instead of splitting on the literal redirect-source
 * URL, mirroring `list-links.spec.ts`'s equivalent redirect-resolution
 * describe block for `listLinks`.
 */
describe('listExternalLinks — redirect resolution', () => {
	let archive: InstanceType<typeof Archive>;
	const redirectWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_external_links_redirect__',
	);
	const redirectArchiveFilePath = path.resolve(
		redirectWorkingDir,
		'list-external-links-redirect-test.nitpicker',
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

		// Page directly linking to the external canonical destination.
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

		// Page linking to an internal redirect-source that forwards to the
		// same external canonical destination.
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

		// Record /old → https://redirect-target.example.com/ redirect.
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
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(redirectWorkingDir, { recursive: true, force: true });
	});

	it('リダイレクト元経由と直接リンクが同じ正規宛先に集約される', async () => {
		const result = await listExternalLinks(archive);
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			destUrl: 'https://redirect-target.example.com',
			referrerCount: 2,
		});
	});
});

/**
 * A dedicated fixture with its own archive/connection, used for exactly one
 * call. `ensureUrlSortTempTable` caches "already prepared" per Knex
 * connection (`packages/@nitpicker/query/src/url-sort-temp-table.ts`'s
 * `preparedConnections` WeakSet) — reusing the `archive` from the describe
 * blocks above would let an earlier `sortBy: 'destUrl'` call silently
 * prepare the temp table first, masking a regression in the guard that
 * decides whether to prepare it. This connection must never see a valid
 * `type: 'url'` sortBy before the test below, or the test would pass
 * regardless of whether the guard being pinned is correct.
 */
describe('listExternalLinks — 未知の sortBy 値への耐性', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_list_external_links_sortby__');
	const archiveFilePath = path.resolve(dir, 'list-external-links-sortby-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
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
			url: parseUrl('https://example.com/page')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Page' },
			anchorList: [
				{
					href: parseUrl('https://external.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'External',
				},
			],
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
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('この接続への最初の呼び出しが未知の sortBy でも例外を投げない', async () => {
		// Simulates an unsanitized query-param value reaching the query layer
		// (the viewer route casts `sortBy` from the raw HTTP query string
		// without validating it). Must be the first call against this
		// connection — see the file-level comment above.
		const result = await listExternalLinks(archive, {
			sortBy: 'sourceUrl' as unknown as 'destUrl',
		});
		expect(result.items).toEqual([
			{ destUrl: 'https://external.example.com', status: 200, referrerCount: 1 },
		]);
	});
});
