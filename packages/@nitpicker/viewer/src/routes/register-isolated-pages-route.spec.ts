import type { ArchiveContext } from '../types.js';
import type { ArchiveManager } from '@nitpicker/query';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';
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
 * Builds a fixture archive with three singleton (unlinked) inventory-*
 * pages spanning two statuses and two sources, so `status`/`source`
 * filters (single and repeated-array OR) have distinguishable subsets to
 * match against.
 * @param workingDir - Unique scratch directory for this fixture.
 * @returns The opened archive — caller closes it in `afterAll`.
 */
async function buildFixtureArchive(
	workingDir: string,
): Promise<InstanceType<typeof Archive>> {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);

	await archive.setPage(
		{
			url: parseUrl('https://example.com/solo-1')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Solo 1' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		},
		'inventory-seed',
	);
	await archive.setPage(
		{
			url: parseUrl('https://example.com/solo-2')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Solo 2' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		},
		'inventory-discovered',
	);
	await archive.setPage(
		{
			url: parseUrl('https://example.com/solo-3')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 500,
			statusText: 'Internal Server Error',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Solo 3' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		},
		'inventory-seed',
	);

	return archive;
}

describe('registerIsolatedPagesRoute — /api/isolated-pages (integration)', () => {
	describe('archive mode (read model built) — fast path', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_isolated_pages_route__',
		);
		let archive: InstanceType<typeof Archive>;
		let app: ReturnType<typeof createApp>;

		beforeAll(async () => {
			archive = await buildFixtureArchive(workingDir);
			await buildViewerReadModel(archive);

			const context: ArchiveContext = {
				manager: { get: () => archive } as unknown as ArchiveManager,
				archiveId: 'test-pages-archive',
				filePath: workingDir,
				mode: 'archive',
				crawlerLockHolder: null,
			};
			app = createApp({
				context,
				publicDir: '/tmp/no-such-dir-register-isolated-pages-route-spec',
			});
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('keeps the single-value status filter working', async () => {
			const res = await app.request('/api/isolated-pages?status=200');
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(1);
			expect(body.items[0]!.url).toBe('https://example.com/solo-1');
		});

		it('OR-filters across a repeated status query param', async () => {
			const res = await app.request('/api/isolated-pages?status=200&status=404');
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(2);
			expect(body.items.map((i) => i.url).toSorted()).toEqual([
				'https://example.com/solo-1',
				'https://example.com/solo-2',
			]);
		});

		it('OR-filters across a repeated source query param', async () => {
			const res = await app.request(
				'/api/isolated-pages?source=inventory-seed&source=inventory-discovered',
			);
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(3);
		});

		it('paginates via limit/offset without breaking the total count', async () => {
			const res = await app.request('/api/isolated-pages?limit=2&offset=0');
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(3);
			expect(body.items).toHaveLength(2);
		});
	});

	describe('stub mode (legacy fallback path)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_isolated_pages_route_stub__',
		);
		let archive: InstanceType<typeof Archive>;
		let app: ReturnType<typeof createApp>;

		beforeAll(async () => {
			archive = await buildFixtureArchive(workingDir);
			// Live-crawl stub mode forces the legacy branch in the route
			// regardless of read-model presence — no buildViewerReadModel call.

			const context: ArchiveContext = {
				manager: { get: () => archive } as unknown as ArchiveManager,
				archiveId: 'test-pages-stub',
				filePath: workingDir,
				mode: 'stub',
				crawlerLockHolder: null,
			};
			app = createApp({
				context,
				publicDir: '/tmp/no-such-dir-register-isolated-pages-route-stub-spec',
			});
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('keeps the single-value status filter working', async () => {
			const res = await app.request('/api/isolated-pages?status=200');
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(1);
			expect(body.items[0]!.url).toBe('https://example.com/solo-1');
		});

		it('degrades a repeated status query param to its first value instead of throwing or matching nothing', async () => {
			const res = await app.request('/api/isolated-pages?status=200&status=404');
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(1);
			expect(body.items[0]!.url).toBe('https://example.com/solo-1');
		});

		it('degrades a repeated source query param to its first value instead of throwing or matching nothing', async () => {
			const res = await app.request(
				'/api/isolated-pages?source=inventory-discovered&source=inventory-seed',
			);
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(1);
			expect(body.items[0]!.url).toBe('https://example.com/solo-2');
		});
	});
});
