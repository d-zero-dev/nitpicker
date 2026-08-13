import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { ArchiveManager } from '@nitpicker/query';
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

describe('registerPageTechnologiesRoute (integration)', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_register_page_technologies_route__',
	);
	let app: ReturnType<typeof createApp>;
	let manager: InstanceType<typeof ArchiveManager>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		const archive = await Archive.create({
			filePath: path.resolve(workingDir, 'fixture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(BASE_CONFIG);
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
			html: '<html><div id="__next"></div></html>',
			meta: { tags: { detected: {}, entries: [] } } as never,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

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
			publicDir: '/tmp/no-such-dir-register-page-technologies-route-spec',
		});
	});

	afterAll(async () => {
		await manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('GET /api/pages/technologies?url= returns the page technologies with signals', async () => {
		const res = await app.request(
			`/api/pages/technologies?url=${encodeURIComponent('https://example.com')}`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			technologies: { technology: string; signals: unknown[] }[];
		};
		expect(body.technologies).toEqual([
			expect.objectContaining({ technology: 'Next.js' }),
		]);
		expect(body.technologies[0]!.signals.length).toBeGreaterThan(0);
	});

	it('GET /api/pages/technologies without a url param returns 400', async () => {
		const res = await app.request('/api/pages/technologies');
		expect(res.status).toBe(400);
	});
});
