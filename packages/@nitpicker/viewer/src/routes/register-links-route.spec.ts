import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { ArchiveManager, buildViewerReadModel } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../create-app.js';

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

/**
 * Builds a fixture archive with 2 internal pages linking to the same
 * external destination (one page with 2 anchors, one with 1 — referrer
 * count must land on 2, not 3) and returns an in-process Hono app wired to
 * it via the same read-only-open path the real viewer uses, mirroring
 * `register-pages-route.spec.ts`'s `buildFixture` helper.
 * @param workingDir - Unique scratch directory for this fixture.
 * @param withReadModel - Whether to build the `viewer_external_links` read
 *   model before opening read-only (exercises the fast path) or leave it
 *   unbuilt (exercises the live fallback path).
 * @returns The app, archive, and manager — callers must close both in
 *   `afterAll`.
 */
async function buildFixture(workingDir: string, withReadModel: boolean) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);

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
		meta: META,
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
		meta: META,
		anchorList: [
			{
				href: parseUrl('https://ads.example.com/')!,
				isExternal: true,
				title: null,
				textContent: 'Ad sidebar',
			},
			{
				href: parseUrl('https://example.com/broken')!,
				isExternal: false,
				title: null,
				textContent: 'Broken link',
			},
		],
		imageList: [],
		isSkipped: false,
	});
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
		url: parseUrl('https://example.com/broken')!,
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

	if (withReadModel) {
		await buildViewerReadModel(archive);
	}

	const manager = new ArchiveManager();
	const { archiveId, mode } = await manager.open(archive.tmpDir);
	const app = createApp({
		context: {
			manager,
			archiveId,
			filePath: archive.tmpDir,
			mode,
			crawlerLockHolder: null,
		},
		publicDir: '/tmp/no-such-dir-register-links-route-spec',
	});
	return { app, archive, manager };
}

describe('registerLinksRoute — /api/links?type=external (integration)', () => {
	describe('fast path (viewer_external_links read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_links_route_fast__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns the destination-deduped shape with the correct referrer count', async () => {
			const res = await fixture.app.request('/api/links?type=external');
			const body = (await res.json()) as {
				items: { destUrl: string; status: number | null; referrerCount: number }[];
				total: number;
			};
			expect(body.total).toBe(1);
			expect(body.items).toEqual([
				{ destUrl: 'https://ads.example.com', status: 200, referrerCount: 2 },
			]);
		});

		it('OR-filters across a repeated status query param', async () => {
			const res = await fixture.app.request(
				'/api/links?type=external&status=200&status=404',
			);
			const body = (await res.json()) as { items: unknown[]; total: number };
			expect(body.total).toBe(1);
		});
	});

	describe('live fallback path (no read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_links_route_live__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, false);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns the same destination-deduped shape via the live query', async () => {
			const res = await fixture.app.request('/api/links?type=external');
			const body = (await res.json()) as {
				items: { destUrl: string; status: number | null; referrerCount: number }[];
				total: number;
			};
			expect(body.total).toBe(1);
			expect(body.items).toEqual([
				{ destUrl: 'https://ads.example.com', status: 200, referrerCount: 2 },
			]);
		});

		it('narrows a multi-value status to its first element (live path has no OR equivalent)', async () => {
			const res = await fixture.app.request(
				'/api/links?type=external&status=200&status=404',
			);
			const body = (await res.json()) as { items: unknown[]; total: number };
			expect(body.total).toBe(1);
		});
	});
});

describe('registerLinksRoute — /api/links?type=broken (integration)', () => {
	describe('fast path (viewer_anchor_facts read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_links_route_broken_fast__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns the broken-link shape with a nextCursor contract', async () => {
			const res = await fixture.app.request('/api/links?type=broken');
			const body = (await res.json()) as {
				items: { sourceUrl: string; destUrl: string; status: number | null }[];
				total: number;
				nextCursor: string | null;
				prevCursor: string | null;
			};
			expect(body.total).toBe(1);
			expect(body.items).toEqual([
				{
					sourceUrl: 'https://example.com/page-b',
					destUrl: 'https://example.com/broken',
					status: 404,
					isExternal: false,
					textContent: null,
				},
			]);
			expect(body.nextCursor).toBeNull();
			expect(body.prevCursor).toBeNull();
		});

		it('OR-filters across a repeated status query param', async () => {
			const res = await fixture.app.request(
				'/api/links?type=broken&status=404&status=500',
			);
			const body = (await res.json()) as { items: unknown[]; total: number };
			expect(body.total).toBe(1);
		});

		it('forces the live fallback when urlPattern is set, since no single index covers source-OR-dest matching', async () => {
			const res = await fixture.app.request(
				`/api/links?type=broken&urlPattern=${encodeURIComponent('%page-b%')}`,
			);
			const body = (await res.json()) as {
				items: { sourceUrl: string }[];
				total: number;
			};
			expect(body.total).toBe(1);
			expect(body.items[0]!.sourceUrl).toBe('https://example.com/page-b');
		});
	});

	describe('fast path — sortBy outside the read model’s narrower union', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_links_route_broken_unsupported_sort__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			const archive = await Archive.create({
				filePath: path.resolve(workingDir, 'fixture.nitpicker'),
				cwd: workingDir,
			});
			await archive.setConfig(BASE_CONFIG);

			// `s1`'s broken destination is external, `s2`'s is internal.
			// Sorting by `sourceUrl` (the fast path's silent fallback if the
			// unsupported-sort guard were missing) would place `s1` before
			// `s2` (alphabetical). Sorting by `isExternal` ascending (only
			// `listLinks`, the live path, supports this) places the
			// internal destination (`s2`) first instead — a result only
			// reachable by actually forcing the live fallback.
			await archive.setPage({
				url: parseUrl('https://example.com/s1')!,
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
				anchorList: [
					{
						href: parseUrl('https://ext.example.com/e1')!,
						isExternal: true,
						title: null,
						textContent: 'External broken',
					},
				],
				imageList: [],
				isSkipped: false,
			});
			await archive.setPage({
				url: parseUrl('https://example.com/s2')!,
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
				anchorList: [
					{
						href: parseUrl('https://example.com/i1')!,
						isExternal: false,
						title: null,
						textContent: 'Internal broken',
					},
				],
				imageList: [],
				isSkipped: false,
			});
			await archive.setPage({
				url: parseUrl('https://ext.example.com/e1')!,
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
				url: parseUrl('https://example.com/i1')!,
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

			await buildViewerReadModel(archive);

			const manager = new ArchiveManager();
			const { archiveId, mode } = await manager.open(archive.tmpDir);
			const app = createApp({
				context: {
					manager,
					archiveId,
					filePath: archive.tmpDir,
					mode,
					crawlerLockHolder: null,
				},
				publicDir: '/tmp/no-such-dir-register-links-route-spec',
			});
			fixture = { app, archive, manager };
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('forces the live fallback for sortBy=isExternal, which viewer_anchor_facts has no index for', async () => {
			const res = await fixture.app.request(
				'/api/links?type=broken&sortBy=isExternal&sortOrder=asc',
			);
			const body = (await res.json()) as { items: { sourceUrl: string }[] };
			expect(body.items.map((item) => item.sourceUrl)).toEqual([
				'https://example.com/s2',
				'https://example.com/s1',
			]);
		});
	});

	describe('live fallback path (no read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_links_route_broken_live__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, false);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns the same broken-link shape via the live query, with an offset-string nextCursor', async () => {
			const res = await fixture.app.request('/api/links?type=broken');
			const body = (await res.json()) as {
				items: { sourceUrl: string; destUrl: string; status: number | null }[];
				total: number;
				nextCursor: string | null;
			};
			expect(body.total).toBe(1);
			expect(body.items[0]).toMatchObject({
				sourceUrl: 'https://example.com/page-b',
				destUrl: 'https://example.com/broken',
				status: 404,
			});
			expect(body.nextCursor).toBeNull();
		});

		it('narrows a multi-value status to its first element (live path has no OR equivalent)', async () => {
			// The single broken link is status 404. Putting a non-matching
			// status first proves the live path uses only that first
			// element rather than OR-ing across the whole array — if it
			// did, the real 404 later in the array would still match.
			const res = await fixture.app.request(
				'/api/links?type=broken&status=500&status=404',
			);
			const body = (await res.json()) as { items: unknown[]; total: number };
			expect(body.total).toBe(0);
		});
	});
});
