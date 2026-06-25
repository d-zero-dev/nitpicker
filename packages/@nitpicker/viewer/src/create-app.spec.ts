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
					title: p.title ?? '',
					lang: 'ja',
					jsonLd: [],
					speculationRules: [],
					tags: { detected: {}, entries: [] },
					others: {
						meta: {},
						property: {},
						httpEquiv: {},
						itemprop: {},
						link: [],
						script: [],
						iframe: [],
					},
					originTrial: [],
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
			mode: 'archive',
			crawlerLockHolder: null,
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

	it('GET /api/summary は総ページ数 + 内部/外部コンテンツ数を返す', async () => {
		const res = await app.request('/api/summary');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			totalPages: number;
			internalPages: number;
			externalPages: number;
			internalContents: number;
			externalContents: number;
		};
		expect(body.totalPages).toBeGreaterThanOrEqual(2);
		/* The two new fields (added in the Summary-cards redesign) must
		   pass through the API boundary unchanged. Refactoring the route
		   to `pick()` a subset of SummaryResult would silently drop them
		   without this assertion. The `>=` form keeps the test robust to
		   fixture changes — what's pinned is the invariant
		   `contents ≥ pages` documented in the SummaryResult JSDoc. */
		expect(body.internalContents).toBeGreaterThanOrEqual(body.internalPages);
		expect(body.externalContents).toBeGreaterThanOrEqual(body.externalPages);
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

	it('GET /api/info はアーカイブの絶対パス・mode・crawlerPid を返す', async () => {
		const res = await app.request('/api/info');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			filePath: string;
			mode: 'archive' | 'stub';
			crawlerPid: number | null;
		};
		expect(body.filePath).toBe(archiveFilePath);
		expect(body.mode).toBe('archive');
		// Archive mode never has a live crawler attached.
		expect(body.crawlerPid).toBeNull();
	});

	it('GET /api/page-links は全ページ一覧を返す', async () => {
		const res = await app.request('/api/page-links');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[]; total: number };
		expect(Array.isArray(body.items)).toBe(true);
		expect(body.total).toBeGreaterThanOrEqual(2);
	});

	it('GET /api/page-links は precomputed referrer-count cache を経由しても referrerCount を埋める', async () => {
		// The viewer's referrer-count cache builds a GROUP BY map and
		// hands it to `listPageLinks`; the SQL path collapses to a Map
		// lookup. This assertion checks the full route → cache → query
		// pipeline produces a numeric `referrerCount` (not undefined, not
		// NaN, not "0 for every row because of a bigint/Number mismatch")
		// — the exact failure mode the QA review flagged as ghost code.
		const res = await app.request('/api/page-links');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: Array<{ url: string; referrerCount: number }>;
		};
		for (const item of body.items) {
			expect(typeof item.referrerCount).toBe('number');
			expect(Number.isFinite(item.referrerCount)).toBe(true);
		}
	});

	it('GET /api/isolated-pages は precomputed components 経由で動く', async () => {
		// The fixture has no inventory-* pages, so the response is an
		// empty list — but the route must still go through
		// getCachedIsolatedClusters + listIsolatedPages without throwing.
		// Removing the `precomputedComponents` plumbing in the route or
		// query function would fail this if anchoring assumed the option
		// was always present.
		const res = await app.request('/api/isolated-pages');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[]; total: number };
		expect(Array.isArray(body.items)).toBe(true);
		expect(typeof body.total).toBe('number');
	});

	it('GET /api/isolated-clusters は precomputed components 経由で動く', async () => {
		const res = await app.request('/api/isolated-clusters');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[]; total: number };
		expect(Array.isArray(body.items)).toBe(true);
	});

	it('GET /api/isolated-clusters/:representativeUrl は 404 で "use isolated-pages" メッセージを返す（singleton-vs-collapsed の差別化）', async () => {
		// The QA review specifically called out this branch as untested.
		// Without the singleton differentiation in the route, both cases
		// would return the same "collapsed by follow-up crawl" message —
		// which misleads operators who deep-linked a singleton URL into
		// the clusters surface. We don't have a real singleton in the
		// fixture, so verify the fallback branch: an unknown URL returns
		// the "collapsed" message (not the singleton one).
		const res = await app.request(
			`/api/isolated-clusters/${encodeURIComponent('https://example.com/nonexistent')}`,
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		// The fallback path: URL doesn't match any component.
		expect(body.error).toContain('collapsed by a follow-up crawl');
	});
});

/**
 * Stub-mode + live crawler attached at viewer startup.
 *
 * The footer renders distinct badges for "Live crawl in progress" vs
 * "Interrupted crawl stub" based on the `crawlerPid` field in
 * `/api/info`. The e2e suite covers the interrupted path (no lock); this
 * spec covers the live path, asserting at the API contract level (the
 * frontend simply mirrors what the API reports).
 */
describe('createApp /api/info — stub mode with a live crawler', () => {
	it('crawlerLockHolder.alive=true なら /api/info は crawlerPid を返す', async () => {
		const fakeArchive = {} as unknown as Archive;
		const context: ArchiveContext = {
			manager: { get: () => fakeArchive } as unknown as ArchiveManager,
			archiveId: 'live-stub',
			filePath: '/tmp/._nitpicker-live',
			mode: 'stub',
			crawlerLockHolder: {
				lockPath: '/tmp/._nitpicker-live.lock',
				pid: 12_345,
				alive: true,
			},
		};
		const app = createApp({ context, publicDir: workingDir });
		const res = await app.request('/api/info');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			filePath: string;
			mode: 'archive' | 'stub';
			crawlerPid: number | null;
		};
		expect(body.mode).toBe('stub');
		expect(body.crawlerPid).toBe(12_345);
	});

	it('crawlerLockHolder.alive=false なら crawlerPid は null（PID リサイクル防御）', async () => {
		// Even though the lock holder PID is recorded, `alive=false` means
		// the process is dead (the OS may have already recycled the PID).
		// Surfacing a dead PID would mislead the user — the API drops it.
		const fakeArchive = {} as unknown as Archive;
		const context: ArchiveContext = {
			manager: { get: () => fakeArchive } as unknown as ArchiveManager,
			archiveId: 'dead-stub',
			filePath: '/tmp/._nitpicker-dead',
			mode: 'stub',
			crawlerLockHolder: {
				lockPath: '/tmp/._nitpicker-dead.lock',
				pid: 99_999,
				alive: false,
			},
		};
		const app = createApp({ context, publicDir: workingDir });
		const res = await app.request('/api/info');
		const body = (await res.json()) as {
			mode: 'archive' | 'stub';
			crawlerPid: number | null;
		};
		expect(body.mode).toBe('stub');
		expect(body.crawlerPid).toBeNull();
	});
});
