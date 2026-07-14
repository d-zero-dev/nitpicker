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

/**
 * Builds a fixture archive with 3 internal resources (one referenced twice,
 * one referenced once, one unreferenced) and 1 external resource, and
 * returns an in-process Hono app wired to it via the same read-only-open
 * path the real viewer uses.
 * @param workingDir - Unique scratch directory for this fixture.
 * @param withReadModel - Whether to build the `viewer_resources` read model
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
		compress: false,
		cdn: false,
		headers: {},
	});
	await archive.setResources({
		url: parseUrl('https://cdn.example.net/c.js')!,
		isExternal: true,
		isError: false,
		status: 200,
		statusText: 'OK',
		contentType: 'application/javascript',
		contentLength: 300,
		compress: false,
		cdn: false,
		headers: {},
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
		meta: {
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
		},
		anchorList: [],
		imageList: [],
		isSkipped: false,
	});
	await archive.setResourcesReferrers({
		url: 'https://example.com/page-a',
		src: 'https://example.com/a.css',
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
		publicDir: '/tmp/no-such-dir-register-resources-route-spec',
	});
	return { app, manager };
}

describe('registerResourcesRoute — /api/resources (integration)', () => {
	describe('fast path (viewer_resources read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_resources_route_fast__',
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

		it('returns every resource in url order with precomputed referrerCount and a cursor contract', async () => {
			const res = await fixture.app.request('/api/resources');
			const body = (await res.json()) as {
				items: { url: string; referrerCount: number }[];
				total: number;
				nextCursor: string | null;
				prevCursor: string | null;
			};
			expect(body.total).toBe(3);
			expect(body.items.map((i) => i.url)).toEqual([
				'https://cdn.example.net/c.js',
				'https://example.com/a.css',
				'https://example.com/b.js',
			]);
			expect(body.items.find((i) => i.url.endsWith('a.css'))?.referrerCount).toBe(1);
			expect(body.items.find((i) => i.url.endsWith('b.js'))?.referrerCount).toBe(0);
			expect(body.nextCursor).toBeNull();
			expect(body.prevCursor).toBeNull();
		});

		it('filters by isExternal via the fast path', async () => {
			const res = await fixture.app.request('/api/resources?isExternal=true');
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(1);
			expect(body.items[0]!.url).toBe('https://cdn.example.net/c.js');
		});

		it('filters by status via the fast path — regression test for a dropped status filter', async () => {
			const res = await fixture.app.request('/api/resources?status=404');
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(1);
			expect(body.items[0]!.url).toBe('https://example.com/b.js');
		});

		it('forces the legacy fallback when urlPattern is set', async () => {
			const res = await fixture.app.request(
				`/api/resources?urlPattern=${encodeURIComponent('%a.css%')}`,
			);
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(1);
			expect(body.items[0]!.url).toBe('https://example.com/a.css');
		});

		it('forces the legacy fallback for a sortBy the fast path does not index', async () => {
			const res = await fixture.app.request(
				'/api/resources?sortBy=referrerCount&sortOrder=desc',
			);
			const body = (await res.json()) as { items: { url: string }[] };
			expect(body.items[0]!.url).toBe('https://example.com/a.css');
		});
	});

	describe('legacy fallback path (no read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_resources_route_legacy__',
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

		it('returns the same shape via the legacy live query, with an offset-string nextCursor', async () => {
			const res = await fixture.app.request('/api/resources');
			const body = (await res.json()) as {
				items: { url: string; referrerCount: number }[];
				total: number;
				nextCursor: string | null;
			};
			expect(body.total).toBe(3);
			expect(body.items.map((i) => i.url)).toEqual([
				'https://cdn.example.net/c.js',
				'https://example.com/a.css',
				'https://example.com/b.js',
			]);
			expect(body.items.find((i) => i.url.endsWith('a.css'))?.referrerCount).toBe(1);
			expect(body.nextCursor).toBeNull();
		});
	});
});
