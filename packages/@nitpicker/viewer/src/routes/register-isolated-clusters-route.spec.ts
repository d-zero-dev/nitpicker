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
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_register_isolated_clusters_route__',
);

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
 * Builds a fixture archive with three size-2 clusters — representative
 * statuses 200, 404, and 500 respectively — so `status` filters (single
 * and repeated-array OR) have distinguishable subsets to match against, and
 * pagination has more than one page to walk through.
 * @returns The opened archive — caller closes it in `afterAll`.
 */
async function buildFixtureArchive(): Promise<InstanceType<typeof Archive>> {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);

	const clusters: [string, string, number][] = [
		['cluster-a', 'cluster-b', 200],
		['cluster-c', 'cluster-d', 404],
		['cluster-e', 'cluster-f', 500],
	];
	for (const [repName, memberName, status] of clusters) {
		await archive.setPage(
			{
				url: parseUrl(`https://example.com/${repName}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...META, title: repName },
				anchorList: [
					{
						href: parseUrl(`https://example.com/${memberName}`)!,
						isExternal: false,
						title: null,
						textContent: memberName,
						hash: null,
					},
				],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);
		await archive.setPage(
			{
				url: parseUrl(`https://example.com/${memberName}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...META, title: memberName },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-discovered',
		);
	}

	return archive;
}

describe('registerIsolatedClustersRoute — /api/isolated-clusters (integration)', () => {
	describe('archive mode (read model built) — fast path', () => {
		let archive: InstanceType<typeof Archive>;
		let app: ReturnType<typeof createApp>;

		beforeAll(async () => {
			archive = await buildFixtureArchive();
			await buildViewerReadModel(archive);

			const context: ArchiveContext = {
				manager: { get: () => archive } as unknown as ArchiveManager,
				archiveId: 'test-clusters-archive',
				filePath: workingDir,
				mode: 'archive',
				crawlerLockHolder: null,
			};
			app = createApp({
				context,
				publicDir: '/tmp/no-such-dir-register-isolated-clusters-route-spec',
			});
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('keeps the single-value status filter working', async () => {
			const res = await app.request('/api/isolated-clusters?status=200');
			const body = (await res.json()) as {
				items: { representativeUrl: string }[];
				total: number;
			};
			expect(body.total).toBe(1);
			expect(body.items[0]!.representativeUrl).toBe('https://example.com/cluster-a');
		});

		it('OR-filters across a repeated status query param', async () => {
			const res = await app.request('/api/isolated-clusters?status=200&status=404');
			const body = (await res.json()) as {
				items: { representativeUrl: string }[];
				total: number;
			};
			expect(body.total).toBe(2);
			expect(body.items.map((i) => i.representativeUrl).toSorted()).toEqual([
				'https://example.com/cluster-a',
				'https://example.com/cluster-c',
			]);
		});

		it('paginates via limit/offset without breaking the total count', async () => {
			const res = await app.request('/api/isolated-clusters?limit=2&offset=0');
			const body = (await res.json()) as {
				items: { representativeUrl: string }[];
				total: number;
			};
			expect(body.total).toBe(3);
			expect(body.items).toHaveLength(2);
		});

		it('returns the full member list for a valid representativeUrl', async () => {
			const res = await app.request(
				`/api/isolated-clusters/${encodeURIComponent('https://example.com/cluster-a')}`,
			);
			const body = (await res.json()) as { size: number; members: { url: string }[] };
			expect(body.size).toBe(2);
			expect(body.members.map((m) => m.url).toSorted()).toEqual([
				'https://example.com/cluster-a',
				'https://example.com/cluster-b',
			]);
		});

		it('OR-filters cluster-detail members across a repeated status query param', async () => {
			const url = encodeURIComponent('https://example.com/cluster-a');
			const res = await app.request(
				`/api/isolated-clusters/${url}?status=200&status=404`,
			);
			const body = (await res.json()) as { size: number; members: { url: string }[] };
			expect(body.size).toBe(2);
		});

		it('OR-filters cluster-detail members across a repeated source query param', async () => {
			const url = encodeURIComponent('https://example.com/cluster-a');
			const res = await app.request(
				`/api/isolated-clusters/${url}?source=inventory-seed&source=inventory-discovered`,
			);
			const body = (await res.json()) as { size: number };
			expect(body.size).toBe(2);
		});

		it('returns 404 for a representativeUrl that matches no cluster', async () => {
			const res = await app.request(
				`/api/isolated-clusters/${encodeURIComponent('https://example.com/no-such-cluster')}`,
			);
			expect(res.status).toBe(404);
		});
	});

	describe('stub mode (legacy fallback path)', () => {
		let archive: InstanceType<typeof Archive>;
		let app: ReturnType<typeof createApp>;
		const stubWorkingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_isolated_clusters_route_stub__',
		);

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(stubWorkingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(stubWorkingDir, 'fixture.nitpicker'),
				cwd: stubWorkingDir,
			});
			await archive.setConfig(BASE_CONFIG);

			const clusters: [string, string, number][] = [
				['cluster-a', 'cluster-b', 200],
				['cluster-c', 'cluster-d', 404],
			];
			for (const [repName, memberName, status] of clusters) {
				await archive.setPage(
					{
						url: parseUrl(`https://example.com/${repName}`)!,
						redirectPaths: [],
						isExternal: false,
						isTarget: true,
						status,
						statusText: 'OK',
						contentType: 'text/html',
						contentLength: 100,
						responseHeaders: {},
						html: '<html></html>',
						meta: { ...META, title: repName },
						anchorList: [
							{
								href: parseUrl(`https://example.com/${memberName}`)!,
								isExternal: false,
								title: null,
								textContent: memberName,
								hash: null,
							},
						],
						imageList: [],
						isSkipped: false,
					},
					'inventory-seed',
				);
				await archive.setPage(
					{
						url: parseUrl(`https://example.com/${memberName}`)!,
						redirectPaths: [],
						isExternal: false,
						isTarget: true,
						status: 200,
						statusText: 'OK',
						contentType: 'text/html',
						contentLength: 100,
						responseHeaders: {},
						html: '<html></html>',
						meta: { ...META, title: memberName },
						anchorList: [],
						imageList: [],
						isSkipped: false,
					},
					'inventory-discovered',
				);
			}

			// Live-crawl stub mode forces the legacy branch in the route
			// regardless of read-model presence — no buildViewerReadModel call.
			const context: ArchiveContext = {
				manager: { get: () => archive } as unknown as ArchiveManager,
				archiveId: 'test-clusters-stub',
				filePath: stubWorkingDir,
				mode: 'stub',
				crawlerLockHolder: null,
			};
			app = createApp({
				context,
				publicDir: '/tmp/no-such-dir-register-isolated-clusters-route-stub-spec',
			});
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(stubWorkingDir, { recursive: true, force: true });
		});

		it('keeps the single-value status filter working', async () => {
			const res = await app.request('/api/isolated-clusters?status=200');
			const body = (await res.json()) as {
				items: { representativeUrl: string }[];
				total: number;
			};
			expect(body.total).toBe(1);
			expect(body.items[0]!.representativeUrl).toBe('https://example.com/cluster-a');
		});

		it('degrades a repeated status query param to its first value instead of throwing or matching nothing', async () => {
			const res = await app.request('/api/isolated-clusters?status=200&status=404');
			const body = (await res.json()) as {
				items: { representativeUrl: string }[];
				total: number;
			};
			expect(body.total).toBe(1);
			expect(body.items[0]!.representativeUrl).toBe('https://example.com/cluster-a');
		});

		it('degrades cluster-detail status/source arrays to their first value instead of throwing', async () => {
			const url = encodeURIComponent('https://example.com/cluster-a');
			const res = await app.request(
				`/api/isolated-clusters/${url}?status=200&status=404&source=inventory-discovered&source=inventory-seed`,
			);
			const body = (await res.json()) as { size: number; members: { url: string }[] };
			expect(res.status).toBe(200);
			// Both members are status 200, so the status array narrows to
			// 200 without excluding either; the source array narrows to
			// 'inventory-discovered', which only cluster-b (the
			// inventory-discovered member) satisfies.
			expect(body.size).toBe(1);
			expect(body.members.map((m) => m.url)).toEqual(['https://example.com/cluster-b']);
		});

		it('returns 404 for a representativeUrl that matches no cluster', async () => {
			const res = await app.request(
				`/api/isolated-clusters/${encodeURIComponent('https://example.com/no-such-cluster')}`,
			);
			expect(res.status).toBe(404);
		});
	});
});
