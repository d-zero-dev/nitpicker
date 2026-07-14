import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getViewerIsolatedCluster } from './get-viewer-isolated-cluster.js';
import { listViewerIsolatedClusters } from './list-viewer-isolated-clusters.js';
import { listViewerIsolatedPages } from './list-viewer-isolated-pages.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const dirname = path.dirname(new URL(import.meta.url).pathname);
const workingDir = path.resolve(dirname, '__test_fixtures_viewer_isolated_read_model__');

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

describe('viewer isolated read model', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'viewer-isolated-read-model.nitpicker',
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
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Home' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage(
			{
				url: parseUrl('https://example.com/lonely-seed')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...META, title: 'Lonely Seed' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);

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
				status: 404,
				statusText: 'Not Found',
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

		await populateMigrationTables(archive);
		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('singletons を viewer_isolated_* から返す', async () => {
		const result = await listViewerIsolatedPages(archive);
		expect(result.total).toBe(1);
		expect(result.items).toEqual([
			{
				url: 'https://example.com/lonely-seed',
				title: 'Lonely Seed',
				status: 200,
				source: 'inventory-seed',
			},
		]);
	});

	it('clusters を viewer_isolated_components から返す', async () => {
		const result = await listViewerIsolatedClusters(archive);
		expect(result.total).toBe(1);
		expect(result.items[0]).toEqual({
			representativeUrl: 'https://example.com/cluster-a',
			representativeTitle: 'Cluster A',
			representativeStatus: 200,
			size: 2,
		});
	});

	it('cluster detail はフィルタ後の size を返す', async () => {
		const result = await getViewerIsolatedCluster(
			archive,
			'https://example.com/cluster-a',
			{
				status: 404,
			},
		);
		expect(result).not.toBeNull();
		expect(result?.size).toBe(1);
		expect(result?.members).toEqual([
			{
				url: 'https://example.com/cluster-b',
				title: 'Cluster B',
				status: 404,
				source: 'inventory-discovered',
			},
		]);
	});
});
