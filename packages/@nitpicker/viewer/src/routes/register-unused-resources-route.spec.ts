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
};

/**
 * Builds a fixture archive with an unreferenced internal resource (the
 * canonical unused case), a referenced internal resource (excluded), and an
 * unreferenced external resource (excluded), and returns an in-process Hono
 * app wired to it via the same read-only-open path the real viewer uses.
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
		url: parseUrl('https://example.com/orphan.pdf')!,
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
		url: 'https://example.com/page-using-css',
		src: 'https://example.com/used.css',
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
		publicDir: '/tmp/no-such-dir-register-unused-resources-route-spec',
	});
	return { app, manager };
}

describe('registerUnusedResourcesRoute — /api/unused-resources (integration)', () => {
	describe('fast path (viewer_resources read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_unused_resources_route_fast__',
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

		it('returns only the unreferenced internal resource, with a cursor contract', async () => {
			const res = await fixture.app.request('/api/unused-resources');
			const body = (await res.json()) as {
				items: { url: string; source: string }[];
				total: number;
				nextCursor: string | null;
				prevCursor: string | null;
			};
			expect(body.total).toBe(1);
			expect(body.items).toEqual([
				{
					url: 'https://example.com/orphan.pdf',
					status: 200,
					contentType: 'application/pdf',
					contentLength: 1000,
					source: 'crawled',
				},
			]);
			expect(body.nextCursor).toBeNull();
			expect(body.prevCursor).toBeNull();
		});

		it('forces the legacy fallback when urlPattern is set', async () => {
			const res = await fixture.app.request(
				`/api/unused-resources?urlPattern=${encodeURIComponent('%orphan%')}`,
			);
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(1);
			expect(body.items[0]!.url).toBe('https://example.com/orphan.pdf');
		});

		it('forces the legacy fallback for a sortBy the fast path does not index', async () => {
			const res = await fixture.app.request('/api/unused-resources?sortBy=contentLength');
			const body = (await res.json()) as { items: { url: string }[] };
			expect(body.items.map((i) => i.url)).toEqual(['https://example.com/orphan.pdf']);
		});
	});

	describe('legacy fallback path (no read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_unused_resources_route_legacy__',
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
			const res = await fixture.app.request('/api/unused-resources');
			const body = (await res.json()) as {
				items: { url: string }[];
				total: number;
				nextCursor: string | null;
			};
			expect(body.total).toBe(1);
			expect(body.items[0]!.url).toBe('https://example.com/orphan.pdf');
			expect(body.nextCursor).toBeNull();
		});
	});
});
