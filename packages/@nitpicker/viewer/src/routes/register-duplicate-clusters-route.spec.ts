import type { Meta } from '@d-zero/beholder';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { ArchiveManager } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../create-app.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_register_duplicate_clusters_route__',
);

/**
 * Same pragmatic partial-Meta convention as `list-duplicate-body-clusters.spec.ts`.
 * @param title
 */
function buildMeta(title: string): Meta {
	return { title } as unknown as Meta;
}

/** Response entry shape of `GET /api/duplicate-clusters`. */
interface DuplicateClusterResponseEntry {
	signature: string;
	count: number;
	ogUrlMismatchRatio: number;
	samplePages: string[];
	commonDirectories: { directory: string; pageCount: number }[];
}

describe('registerDuplicateClustersRoute — /api/duplicate-clusters (integration)', () => {
	let archive: InstanceType<typeof Archive>;
	let manager: ArchiveManager;
	let app: ReturnType<typeof createApp>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'fixture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: false,
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

		for (let i = 0; i < 3; i++) {
			await archive.setPage({
				url: parseUrl(`https://example.com/trap/${i}/`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html><body>trap body</body></html>',
				meta: buildMeta('お知らせ'),
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		manager = new ArchiveManager();
		const { archiveId, mode } = await manager.open(archive.tmpDir);
		app = createApp({
			context: {
				manager,
				archiveId,
				filePath: archive.tmpDir,
				mode,
				crawlerLockHolder: null,
			},
			publicDir: '/tmp/no-such-dir-register-duplicate-clusters-route-spec',
		});
	});

	afterAll(async () => {
		await manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('minCount=3 で3ページのクラスタを返す', async () => {
		const res = await app.request('/api/duplicate-clusters?minCount=3');
		const body = (await res.json()) as DuplicateClusterResponseEntry[];
		expect(body).toHaveLength(1);
		expect(body[0]?.count).toBe(3);
		expect(body[0]?.signature).toMatch(/^[0-9a-f]{64}$/);
	});

	it('デフォルトのminCount(10)未満のためクラスタなしを返す', async () => {
		const res = await app.request('/api/duplicate-clusters');
		const body = (await res.json()) as DuplicateClusterResponseEntry[];
		expect(body).toEqual([]);
	});

	it('samplePagesLimitでsamplePagesを切り詰める', async () => {
		const res = await app.request(
			'/api/duplicate-clusters?minCount=3&samplePagesLimit=1',
		);
		const body = (await res.json()) as DuplicateClusterResponseEntry[];
		expect(body[0]?.samplePages).toHaveLength(1);
		expect(body[0]?.count).toBe(3);
	});
});
