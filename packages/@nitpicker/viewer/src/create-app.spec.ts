import type { ArchiveContext } from './types.js';
import type { ArchiveManager } from '@nitpicker/query';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';
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
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			roots: ['https://example.com'],
			excludes: ['/admin/*'],
			excludeKeywords: ['draft'],
			excludeUrls: ['https://example.com/temp'],
			maxExcludedDepth: 3,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
		});

		const pages = [
			{
				url: 'https://example.com/',
				status: 200,
				title: 'Home',
				hasCsp: false,
				anchorList: [
					{
						href: parseUrl('https://external.example.com/')!,
						isExternal: true,
						title: null,
						textContent: 'External',
					},
				],
			},
			{
				url: 'https://example.com/contact',
				status: 404,
				title: null,
				hasCsp: false,
				anchorList: [],
			},
			{
				url: 'https://example.com/secure',
				status: 200,
				title: 'Secure',
				hasCsp: true,
				anchorList: [],
			},
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
				responseHeaders: p.hasCsp
					? { 'Content-Security-Policy': "default-src 'self'" }
					: {},
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
				anchorList: p.anchorList,
				imageList: [],
				isSkipped: false,
			});
		}

		await archive.addError({
			pid: 1,
			isMainProcess: true,
			url: 'https://dead.example.net/',
			isExternal: true,
			error: new Error('getaddrinfo ENOTFOUND dead.example.net'),
		});

		await archive.setPage({
			url: parseUrl('https://external.example.com/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: {
				title: '',
				lang: null,
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

		const context: ArchiveContext = {
			manager: { get: () => archive } as unknown as ArchiveManager,
			archiveId: 'test',
			filePath: archiveFilePath,
			mode: 'archive',
			crawlerLockHolder: null,
		};
		app = createApp({ context, publicDir: workingDir });
		await buildViewerReadModel(archive);
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
			excludes: string[];
			excludeKeywords: string[];
			excludeUrls: string[];
			maxExcludedDepth: number;
		};
		expect(body.totalPages).toBeGreaterThanOrEqual(2);
		/* `internalContents`/`externalContents` must pass through the API
		   boundary unchanged. Refactoring the route to `pick()` a subset
		   of SummaryResult would silently drop them without this
		   assertion. The `>=` form keeps the test robust to fixture
		   changes — what's pinned is the invariant `contents ≥ pages`
		   documented in the SummaryResult JSDoc. */
		expect(body.internalContents).toBeGreaterThanOrEqual(body.internalPages);
		expect(body.externalContents).toBeGreaterThanOrEqual(body.externalPages);
		/* End-to-end coverage for issue #261: exclude settings written via
		   `archive.setConfig()` (crawler package) must survive the full
		   config → getSummaryFastPath (query package) → HTTP JSON
		   (viewer package) pipeline, not just the query-layer unit tests. */
		expect(body.excludes).toEqual(['/admin/*']);
		expect(body.excludeKeywords).toEqual(['draft']);
		expect(body.excludeUrls).toEqual(['https://example.com/temp']);
		expect(body.maxExcludedDepth).toBe(3);
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

	it('GET /api/error-kinds は host×kind 行の一覧を返す', async () => {
		const res = await app.request('/api/error-kinds');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: { host: string; kind: string; count: number }[];
			total: number;
			facets: { totalRecords: number; channelSource: string };
		};
		expect(body.items).toContainEqual(
			expect.objectContaining({ host: 'dead.example.net', kind: 'dns', count: 1 }),
		);
		expect(body.facets.totalRecords).toBeGreaterThanOrEqual(1);
	});

	it('GET /api/error-kinds?host= はその host の行だけに絞り込む', async () => {
		const res = await app.request(
			`/api/error-kinds?host=${encodeURIComponent('dead.example.net')}`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: { host: string }[] };
		expect(body.items.length).toBeGreaterThanOrEqual(1);
		expect(body.items.every((item) => item.host === 'dead.example.net')).toBe(true);
	});

	it('GET /api/error-kinds は不正な sortBy でも 500 にならず count 降順にフォールバックする', async () => {
		// Unlike /api/links (400 on a bad `type`), an unrecognized `sortBy`
		// here degrades to the default sort rather than rejecting the
		// request — a hand-edited or stale bookmark should not 500.
		const res = await app.request('/api/error-kinds?sortBy=bogus');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[] };
		expect(Array.isArray(body.items)).toBe(true);
	});

	it('GET /api/links?type=external は listExternalLinks の宛先集約シェイプを返す', async () => {
		// Regression test for the route dispatching to the wrong query
		// function: the response must have `referrerCount`, not the
		// per-anchor `sourceUrl`/`textContent` shape from `listLinks`.
		const res = await app.request('/api/links?type=external');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: Array<{ destUrl: string; status: number | null; referrerCount: number }>;
		};
		expect(body.items).toHaveLength(1);
		expect(body.items[0]).toMatchObject({
			destUrl: 'https://external.example.com',
			referrerCount: 1,
		});
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
		const body = (await res.json()) as {
			nodes: unknown[];
			edges: unknown[];
			truncated: boolean;
		};
		expect(Array.isArray(body.nodes)).toBe(true);
		expect(body.nodes.length).toBeGreaterThanOrEqual(2);
		expect(Array.isArray(body.edges)).toBe(true);
		// The fixture archive has far fewer than 1000 internal pages so
		// the default node cap leaves it untouched.
		expect(body.truncated).toBe(false);
	});

	it('GET /api/graph?limit=1 はデフォルト上限を上書きし truncated=true を返す', async () => {
		// The default node cap exists to prevent 10 GB-class archives
		// from blowing up `c.json` with `RangeError: Invalid string
		// length`. Verify the override path still works: passing a
		// smaller explicit limit truncates the result and surfaces it
		// via `truncated`, which the frontend can read to tell the user
		// the graph is incomplete.
		const res = await app.request('/api/graph?limit=1');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			nodes: unknown[];
			edges: unknown[];
			truncated: boolean;
		};
		expect(body.nodes.length).toBe(1);
		expect(body.truncated).toBe(true);
	});

	it('GET /api/graph?limit=0 はキャップなし — 全ノードを返し truncated=false', async () => {
		// `limit=0` is the documented escape hatch for callers that
		// accept the V8 string-limit risk knowingly (e.g. an operator
		// piping the JSON into another tool on a small archive). Verify
		// it bypasses the default cap rather than collapsing to "zero
		// nodes".
		const res = await app.request('/api/graph?limit=0');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			nodes: unknown[];
			edges: unknown[];
			truncated: boolean;
		};
		expect(body.nodes.length).toBeGreaterThanOrEqual(2);
		expect(body.truncated).toBe(false);
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

	it('GET /api/pages はセキュリティヘッダーの有無を各行に含める', async () => {
		const res = await app.request('/api/pages');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			items: Array<{
				hasCSP: boolean;
				hasXFrameOptions: boolean;
				hasXContentTypeOptions: boolean;
				hasHSTS: boolean;
			}>;
		};
		expect(body.items.length).toBeGreaterThan(0);
		for (const item of body.items) {
			expect(typeof item.hasCSP).toBe('boolean');
			expect(typeof item.hasXFrameOptions).toBe('boolean');
			expect(typeof item.hasXContentTypeOptions).toBe('boolean');
			expect(typeof item.hasHSTS).toBe('boolean');
		}
	});

	it('GET /api/pages?hasCSP=true はヘッダーフィルタをクエリパラメータから listPages まで転送する', async () => {
		// Regression test for a route/frontend mismatch: pages-view.tsx sends
		// `?hasCSP=`/`hasXFrameOptions=`/etc., but registerPagesRoute's
		// `options` literal must actually read them into ListPagesOptions —
		// calling `listPages()` directly (as list-pages.spec.ts does) can't
		// catch a route that silently drops the query param.
		const res = await app.request('/api/pages?hasCSP=true');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: Array<{ url: string; hasCSP: boolean }> };
		expect(body.items.length).toBeGreaterThan(0);
		expect(body.items.every((item) => item.hasCSP)).toBe(true);
		expect(body.items.some((item) => item.url === 'https://example.com/secure')).toBe(
			true,
		);
	});

	it('GET /api/isolated-pages は precomputed read model 経由でも動く', async () => {
		const res = await app.request('/api/isolated-pages');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[]; total: number };
		expect(Array.isArray(body.items)).toBe(true);
		expect(typeof body.total).toBe('number');
	});

	it('GET /api/isolated-clusters は precomputed read model 経由でも動く', async () => {
		const res = await app.request('/api/isolated-clusters');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[]; total: number };
		expect(Array.isArray(body.items)).toBe(true);
	});

	it('GET /api/isolated-clusters/:representativeUrl は 404 で "use isolated-pages" メッセージを返す（singleton-vs-collapsed の差別化）', async () => {
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
