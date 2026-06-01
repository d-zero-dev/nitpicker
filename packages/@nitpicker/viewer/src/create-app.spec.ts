import type { ArchiveContext } from './types.js';
import type { ArchiveManager } from '@nitpicker/query';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './create-app.js';

const dirname = path.dirname(new URL(import.meta.url).pathname);
const workingDir = path.resolve(dirname, '__test_fixtures_create_app__');

describe('createApp', () => {
	let archive: InstanceType<typeof Archive>;
	let app: ReturnType<typeof createApp>;
	const archiveFilePath = path.resolve(workingDir, 'create-app-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.4.4',
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

		const pages = [
			{ url: 'https://example.com/', status: 200, title: 'Home' },
			{ url: 'https://example.com/contact', status: 404, title: null },
		];
		for (const p of pages) {
			await archive.setPage({
				url: parseUrl(p.url)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: p.status,
				statusText: p.status === 200 ? 'OK' : 'Not Found',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: `<html><head><title>${p.title ?? ''}</title></head></html>`,
				meta: {
					lang: 'ja',
					title: p.title,
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
		}

		const context: ArchiveContext = {
			manager: { get: () => archive } as unknown as ArchiveManager,
			archiveId: 'test',
			filePath: archiveFilePath,
		};
		app = createApp({ context, publicDir: workingDir });
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('GET /api/summary は総ページ数を返す', async () => {
		const res = await app.request('/api/summary');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { totalPages: number };
		expect(body.totalPages).toBeGreaterThanOrEqual(2);
	});

	it('GET /api/pages はページ一覧を返す', async () => {
		const res = await app.request('/api/pages?limit=10');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[]; total: number };
		expect(Array.isArray(body.items)).toBe(true);
		expect(body.total).toBeGreaterThanOrEqual(2);
	});

	it('GET /api/pages/detail は url 未指定で 400 を返す', async () => {
		const res = await app.request('/api/pages/detail');
		expect(res.status).toBe(400);
	});

	it('GET /api/pages/detail は指定ページの詳細を返す', async () => {
		const targetUrl = 'https://example.com/contact';
		const res = await app.request(
			`/api/pages/detail?url=${encodeURIComponent(targetUrl)}`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { url: string };
		expect(body.url).toBe(targetUrl);
	});

	it('GET /api/links は不正な type で 400 を返す', async () => {
		const res = await app.request('/api/links?type=bogus');
		expect(res.status).toBe(400);
	});

	it('GET /api/resources は一覧を返す', async () => {
		const res = await app.request('/api/resources');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[] };
		expect(Array.isArray(body.items)).toBe(true);
	});

	it('GET /api/graph はノードとエッジを返す', async () => {
		const res = await app.request('/api/graph');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
		expect(Array.isArray(body.nodes)).toBe(true);
		expect(body.nodes.length).toBeGreaterThanOrEqual(2);
		expect(Array.isArray(body.edges)).toBe(true);
	});

	it('GET /api/duplicates は不正な field で 400 を返す', async () => {
		const res = await app.request('/api/duplicates?field=bogus');
		expect(res.status).toBe(400);
	});

	it('GET /api/duplicates は field 未指定で 200 を返す', async () => {
		const res = await app.request('/api/duplicates');
		expect(res.status).toBe(200);
	});

	it('GET /api/info はアーカイブの絶対パスを返す', async () => {
		const res = await app.request('/api/info');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { filePath: string };
		expect(body.filePath).toBe(archiveFilePath);
	});

	it('GET /api/page-links は全ページ一覧を返す', async () => {
		const res = await app.request('/api/page-links');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[]; total: number };
		expect(Array.isArray(body.items)).toBe(true);
		expect(body.total).toBeGreaterThanOrEqual(2);
	});
});
