import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getIsolatedCluster } from './get-isolated-cluster.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_get_isolated_cluster__');

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

describe('getIsolatedCluster', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'get-cluster-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
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
		});

		// 2-node cluster: a → b. Representative = /cluster/a (lexicographically smallest).
		await archive.setPage(
			{
				url: parseUrl('https://example.com/cluster/a')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'A' },
				anchorList: [
					{
						href: parseUrl('https://example.com/cluster/b')!,
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
				url: parseUrl('https://example.com/cluster/b')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 404,
				statusText: 'Not Found',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'B' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-discovered',
		);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns the cluster matching the representative URL with all members', async () => {
		const result = await getIsolatedCluster(archive, 'https://example.com/cluster/a');
		expect(result).not.toBeNull();
		expect(result?.representativeUrl).toBe('https://example.com/cluster/a');
		expect(result?.size).toBe(2);
		expect(result?.members.map((m) => m.url)).toEqual([
			'https://example.com/cluster/a',
			'https://example.com/cluster/b',
		]);
		// Members include source labels.
		expect(result?.members[0]?.source).toBe('inventory-seed');
		expect(result?.members[1]?.source).toBe('inventory-discovered');
	});

	it('returns null when the representative URL does not match any cluster', async () => {
		// /cluster/b is a member but NOT the representative — should return null.
		const byMember = await getIsolatedCluster(archive, 'https://example.com/cluster/b');
		expect(byMember).toBeNull();
		// Wholly unknown URL also returns null.
		const unknown = await getIsolatedCluster(
			archive,
			'https://example.com/does-not-exist',
		);
		expect(unknown).toBeNull();
	});

	it('strips internal id field from returned member objects', async () => {
		const result = await getIsolatedCluster(archive, 'https://example.com/cluster/a');
		for (const member of result?.members ?? []) {
			// `id` is an internal index used inside computeIsolatedClusters;
			// the public DTO must not expose database row ids.
			expect(member).not.toHaveProperty('id');
		}
	});

	it('filters cluster members by status', async () => {
		const result = await getIsolatedCluster(archive, 'https://example.com/cluster/a', {
			status: 404,
		});
		expect(result?.size).toBe(1);
		expect(result?.members.map((member) => member.url)).toEqual([
			'https://example.com/cluster/b',
		]);
	});
});
