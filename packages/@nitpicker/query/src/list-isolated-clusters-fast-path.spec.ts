import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listIsolatedClustersFastPath } from './list-isolated-clusters-fast-path.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const dirname = path.dirname(new URL(import.meta.url).pathname);

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
 * Builds a fixture archive with two size-2 clusters — representative
 * statuses 200 and 404 respectively — so a `status: [200, 404]` filter has
 * two distinct clusters to OR across.
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
			url: parseUrl('https://example.com/cluster-a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Cluster A' },
			anchorList: [
				{
					href: parseUrl('https://example.com/cluster-b')!,
					isExternal: false,
					title: null,
					textContent: 'B',
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
			url: parseUrl('https://example.com/cluster-b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Cluster B' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		},
		'inventory-discovered',
	);

	await archive.setPage(
		{
			url: parseUrl('https://example.com/cluster-c')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Cluster C' },
			anchorList: [
				{
					href: parseUrl('https://example.com/cluster-d')!,
					isExternal: false,
					title: null,
					textContent: 'D',
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
			url: parseUrl('https://example.com/cluster-d')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Cluster D' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		},
		'inventory-discovered',
	);

	return archive;
}

describe('listIsolatedClustersFastPath', () => {
	describe('read model built (fast path)', () => {
		const workingDir = path.resolve(
			dirname,
			'__test_fixtures_list_isolated_clusters_fast_path_current__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			archive = await buildFixtureArchive(workingDir);
			await buildViewerReadModel(archive);
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('keeps the single-value status filter working', async () => {
			const result = await listIsolatedClustersFastPath(archive, { status: 200 });
			expect(result.total).toBe(1);
			expect(result.items[0]!.representativeUrl).toBe('https://example.com/cluster-a');
		});

		it('OR-filters across a status array, matching either cluster', async () => {
			const result = await listIsolatedClustersFastPath(archive, {
				status: [200, 404],
			});
			expect(result.total).toBe(2);
			expect(result.items.map((i) => i.representativeUrl).toSorted()).toEqual([
				'https://example.com/cluster-a',
				'https://example.com/cluster-c',
			]);
		});
	});

	describe('read model absent (live fallback)', () => {
		const workingDir = path.resolve(
			dirname,
			'__test_fixtures_list_isolated_clusters_fast_path_live__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			archive = await buildFixtureArchive(workingDir);
			// Deliberately skip buildViewerReadModel — isViewerReadModelCurrent
			// reports false, forcing the live listIsolatedClusters branch.
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('degrades a status array to its first element instead of throwing or matching nothing', async () => {
			const result = await listIsolatedClustersFastPath(archive, {
				status: [200, 404],
			});
			expect(result.total).toBe(1);
			expect(result.items[0]!.representativeUrl).toBe('https://example.com/cluster-a');
		});
	});
});
