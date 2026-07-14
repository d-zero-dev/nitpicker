import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listIsolatedClusters } from './list-isolated-clusters.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_isolated_clusters__');

const EMPTY_META = {
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

describe('listIsolatedClusters', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'list-clusters-test.nitpicker');

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

		// Singleton — must NOT appear in cluster list (clusters are size ≥ 2).
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
				meta: { ...EMPTY_META, title: 'Lonely' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);

		// Cluster of size 3: a → b → c (chained anchors).
		const buildSeed = (
			urlPath: string,
			anchorPath: string | null,
			title: string,
			status = 200,
			statusText = 'OK',
		) => ({
			url: parseUrl(`https://example.com${urlPath}`)!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status,
			statusText,
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...EMPTY_META, title },
			anchorList:
				anchorPath === null
					? []
					: [
							{
								href: parseUrl(`https://example.com${anchorPath}`)!,
								isExternal: false,
								title: null,
								textContent: anchorPath,
								hash: null,
							},
						],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage(
			buildSeed('/big-cluster/a', '/big-cluster/b', 'A'),
			'inventory-seed',
		);
		await archive.setPage(
			buildSeed('/big-cluster/b', '/big-cluster/c', 'B'),
			'inventory-seed',
		);
		await archive.setPage(buildSeed('/big-cluster/c', null, 'C'), 'inventory-seed');

		// Cluster of size 2: x → y.
		await archive.setPage(
			buildSeed('/small-cluster/x', '/small-cluster/y', 'X', 404, 'Not Found'),
			'inventory-seed',
		);
		await archive.setPage(buildSeed('/small-cluster/y', null, 'Y'), 'inventory-seed');
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns size ≥ 2 components only, sorted by size DESC then representative URL ASC', async () => {
		const result = await listIsolatedClusters(archive);
		expect(result.total).toBe(2);
		expect(result.items.map((c) => c.representativeUrl)).toEqual([
			'https://example.com/big-cluster/a',
			'https://example.com/small-cluster/x',
		]);
		expect(result.items[0]?.size).toBe(3);
		expect(result.items[1]?.size).toBe(2);
	});

	it('excludes singletons from the cluster list', async () => {
		const result = await listIsolatedClusters(archive);
		const reps = result.items.map((c) => c.representativeUrl);
		expect(reps).not.toContain('https://example.com/lonely-seed');
	});

	it('reports the representative member title / status', async () => {
		const result = await listIsolatedClusters(archive);
		const big = result.items.find((c) => c.size === 3);
		// Representative = lexicographically smallest member URL → /big-cluster/a → title 'A'.
		expect(big?.representativeTitle).toBe('A');
		expect(big?.representativeStatus).toBe(200);
	});

	it('respects limit and offset across clusters', async () => {
		const first = await listIsolatedClusters(archive, { limit: 1, offset: 0 });
		expect(first.items).toHaveLength(1);
		expect(first.items[0]?.size).toBe(3);
		expect(first.total).toBe(2);
		const second = await listIsolatedClusters(archive, { limit: 1, offset: 1 });
		expect(second.items).toHaveLength(1);
		expect(second.items[0]?.size).toBe(2);
		expect(second.total).toBe(2);
		const third = await listIsolatedClusters(archive, { limit: 1, offset: 2 });
		expect(third.items).toHaveLength(0);
		expect(third.total).toBe(2);
	});

	it('filters cluster summaries by representative status', async () => {
		const result = await listIsolatedClusters(archive, { status: 404 });
		expect(result.total).toBe(1);
		expect(result.items[0]?.representativeUrl).toBe(
			'https://example.com/small-cluster/x',
		);
	});
});
