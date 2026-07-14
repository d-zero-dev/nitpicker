import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
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

const NOOP_META = {
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
 * Builds a fixture archive with 3 images across 1 page (one missing alt, one
 * missing dimensions, one oversized) and returns an in-process Hono app
 * wired to it via the same read-only-open path the real viewer uses.
 * @param workingDir - Unique scratch directory for this fixture.
 * @param withReadModel - Whether to build the `viewer_images` read model
 *   before opening read-only (exercises the fast path) or leave it unbuilt
 *   (exercises the legacy fallback path).
 * @returns The app and manager — callers must close the manager in `afterAll`.
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
		meta: NOOP_META,
		anchorList: [],
		imageList: [
			{
				src: 'https://example.com/a.png',
				currentSrc: 'https://example.com/a.png',
				alt: 'A',
				width: 100,
				height: 100,
				naturalWidth: 100,
				naturalHeight: 100,
				isLazy: false,
				viewportWidth: 1200,
				sourceCode: '<img src="a.png" alt="A">',
			},
			{
				src: 'https://example.com/b.png',
				currentSrc: 'https://example.com/b.png',
				alt: '',
				width: 0,
				height: 0,
				naturalWidth: 50,
				naturalHeight: 50,
				isLazy: false,
				viewportWidth: 1200,
				sourceCode: '<img src="b.png">',
			},
		],
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
		publicDir: '/tmp/no-such-dir-register-images-route-spec',
	});
	return { app, manager };
}

describe('registerImagesRoute — /api/images (integration)', () => {
	describe('fast path (viewer_images read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_images_route_fast__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
			await populateMigrationTables(archive);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns every image with src/currentSrc distinct and a cursor contract', async () => {
			const res = await fixture.app.request('/api/images');
			const body = (await res.json()) as {
				items: { src: string; currentSrc: string }[];
				total: number;
				nextCursor: string | null;
				prevCursor: string | null;
			};
			expect(body.total).toBe(2);
			expect(body.items.map((i) => i.src)).toEqual([
				'https://example.com/a.png',
				'https://example.com/b.png',
			]);
			expect(body.nextCursor).toBeNull();
			expect(body.prevCursor).toBeNull();
		});

		it('filters by missingAlt via the fast path', async () => {
			const res = await fixture.app.request('/api/images?missingAlt=true');
			const body = (await res.json()) as { items: { src: string }[]; total: number };
			expect(body.total).toBe(1);
			expect(body.items[0]!.src).toBe('https://example.com/b.png');
		});

		it('paginates forward via cursor/direction query params — regression test for unreachable cursor pagination', async () => {
			const page1Res = await fixture.app.request('/api/images?limit=1');
			const page1 = (await page1Res.json()) as {
				items: { src: string }[];
				nextCursor: string | null;
			};
			expect(page1.items.map((i) => i.src)).toEqual(['https://example.com/a.png']);
			expect(page1.nextCursor).not.toBeNull();

			const page2Res = await fixture.app.request(
				`/api/images?limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`,
			);
			const page2 = (await page2Res.json()) as {
				items: { src: string }[];
				nextCursor: string | null;
			};
			expect(page2.items.map((i) => i.src)).toEqual(['https://example.com/b.png']);
			expect(page2.nextCursor).toBeNull();
		});

		it('navigates backward via direction=prev — the only production entry point for the backward keyset seek', async () => {
			const page1Res = await fixture.app.request('/api/images?limit=1');
			const page1 = (await page1Res.json()) as {
				items: { src: string }[];
				nextCursor: string | null;
			};
			const page2Res = await fixture.app.request(
				`/api/images?limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`,
			);
			const page2 = (await page2Res.json()) as {
				items: { src: string }[];
				prevCursor: string | null;
			};
			const backToPage1Res = await fixture.app.request(
				`/api/images?limit=1&cursor=${encodeURIComponent(page2.prevCursor!)}&direction=prev`,
			);
			const backToPage1 = (await backToPage1Res.json()) as { items: { src: string }[] };
			expect(backToPage1.items.map((i) => i.src)).toEqual(page1.items.map((i) => i.src));
		});

		it('forces the legacy fallback when urlPattern is set', async () => {
			const res = await fixture.app.request(
				`/api/images?urlPattern=${encodeURIComponent('%a.png%')}`,
			);
			const body = (await res.json()) as { items: { src: string }[]; total: number };
			expect(body.total).toBe(1);
			expect(body.items[0]!.src).toBe('https://example.com/a.png');
		});

		it('forces the legacy fallback for a sortBy the fast path does not index', async () => {
			const res = await fixture.app.request('/api/images?sortBy=alt&sortOrder=desc');
			const body = (await res.json()) as { items: { src: string }[] };
			expect(body.items[0]!.src).toBe('https://example.com/a.png');
		});
	});

	describe('legacy fallback path (no read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_images_route_legacy__',
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

		it('returns the same shape via the legacy live query, with null cursors', async () => {
			const res = await fixture.app.request('/api/images');
			const body = (await res.json()) as {
				items: { src: string }[];
				total: number;
				nextCursor: string | null;
				prevCursor: string | null;
			};
			expect(body.total).toBe(2);
			expect(body.items.map((i) => i.src)).toEqual([
				'https://example.com/a.png',
				'https://example.com/b.png',
			]);
			expect(body.nextCursor).toBeNull();
			expect(body.prevCursor).toBeNull();
		});
	});
});
