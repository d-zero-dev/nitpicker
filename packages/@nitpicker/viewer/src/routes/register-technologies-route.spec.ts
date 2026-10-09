import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import Archive from '@nitpicker/archive/archive';
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

describe('registerTechnologiesRoute (integration)', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_register_technologies_route__',
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
		// A page with no detectable technology, so the `/api/pages?technology=`
		// tests below can tell "filtered" from "everything".
		await archive.setPage({
			url: parseUrl('https://example.com/plain')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html><body></body></html>',
			meta: { tags: { detected: {}, entries: [] } } as never,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await buildViewerReadModel(archive);

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
			publicDir: '/tmp/no-such-dir-register-technologies-route-spec',
		});
	});

	afterAll(async () => {
		await manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('GET /api/technologies returns the site-wide inventory', async () => {
		const res = await app.request('/api/technologies');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			inventory: { technology: string; pageCount: number }[];
		};
		expect(body.inventory).toEqual([
			expect.objectContaining({ technology: 'Next.js', pageCount: 1 }),
		]);
		expect(body).not.toHaveProperty('directoryDistribution');
	});

	it('GET /api/pages?technology= lists only the pages using that technology', async () => {
		const res = await app.request('/api/pages?technology=Next.js');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: { url: string }[]; total: number };
		expect(body.items.map((item) => item.url)).toEqual(['https://example.com']);
		expect(body.total).toBe(1);
	});

	it('GET /api/pages?technology= with an unknown technology lists nothing', async () => {
		const res = await app.request('/api/pages?technology=NoSuchTechnology');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[]; total: number };
		expect(body.items).toEqual([]);
		expect(body.total).toBe(0);
	});

	it('GET /api/pages without a technology filter lists every page', async () => {
		const res = await app.request('/api/pages');
		const body = (await res.json()) as { total: number };
		expect(body.total).toBe(2);
	});
});
