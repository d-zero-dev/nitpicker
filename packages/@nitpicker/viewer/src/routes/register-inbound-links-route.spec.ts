import type { ArchiveContext } from '../types.js';
import type { ArchiveManager } from '@nitpicker/query';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../create-app.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_register_inbound_links_route__',
);

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

describe('registerInboundLinksRoute — /api/pages/inbound-links (integration)', () => {
	describe('archive mode (viewer_anchor_facts read model built)', () => {
		let archive: InstanceType<typeof Archive>;
		let app: ReturnType<typeof createApp>;
		const archiveFilePath = path.resolve(workingDir, 'fixture.nitpicker');

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			await archive.setPage({
				url: parseUrl('https://example.com/target')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
			for (const name of ['referrer-a', 'referrer-b']) {
				await archive.setPage({
					url: parseUrl(`https://example.com/${name}`)!,
					redirectPaths: [],
					isExternal: false,
					isTarget: true,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					contentLength: 100,
					responseHeaders: {},
					html: '',
					meta: META,
					anchorList: [
						{
							href: parseUrl('https://example.com/target')!,
							isExternal: false,
							title: null,
							textContent: `Link from ${name}`,
						},
					],
					imageList: [],
					isSkipped: false,
				});
			}

			await buildViewerReadModel(archive);

			const context: ArchiveContext = {
				manager: { get: () => archive } as unknown as ArchiveManager,
				archiveId: 'test',
				filePath: archiveFilePath,
				mode: 'archive',
				crawlerLockHolder: null,
			};
			app = createApp({
				context,
				publicDir: '/tmp/no-such-dir-register-inbound-links-route-spec',
			});
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('requires the url query parameter', async () => {
			const res = await app.request('/api/pages/inbound-links');
			expect(res.status).toBe(400);
		});

		it('returns 404 for a URL that does not exist', async () => {
			const res = await app.request(
				'/api/pages/inbound-links?url=https://example.com/missing',
			);
			expect(res.status).toBe(404);
		});

		it('returns every referrer with anchor text and count within the default limit', async () => {
			const res = await app.request(
				'/api/pages/inbound-links?url=https://example.com/target',
			);
			const body = (await res.json()) as {
				url: string;
				items: { url: string; textContent: string | null; count: number }[];
				total: number;
				nextCursor: string | null;
			};
			expect(body.total).toBe(2);
			expect(body.items).toHaveLength(2);
			expect(body.items.toSorted((a, b) => a.url.localeCompare(b.url))).toEqual([
				{
					url: 'https://example.com/referrer-a',
					textContent: 'Link from referrer-a',
					count: 1,
				},
				{
					url: 'https://example.com/referrer-b',
					textContent: 'Link from referrer-b',
					count: 1,
				},
			]);
			expect(body.nextCursor).toBeNull();
		});

		it('bounds by the limit query parameter and continues via nextCursor', async () => {
			const first = await app.request(
				'/api/pages/inbound-links?url=https://example.com/target&limit=1',
			);
			const firstBody = (await first.json()) as {
				items: unknown[];
				nextCursor: string | null;
			};
			expect(firstBody.items).toHaveLength(1);
			expect(firstBody.nextCursor).not.toBeNull();

			const second = await app.request(
				`/api/pages/inbound-links?url=https://example.com/target&limit=1&cursor=${firstBody.nextCursor}`,
			);
			const secondBody = (await second.json()) as {
				items: unknown[];
				nextCursor: string | null;
			};
			expect(secondBody.items).toHaveLength(1);
			expect(secondBody.nextCursor).toBeNull();
		});

		it('returns only the total when limit=0, skipping the row window', async () => {
			const res = await app.request(
				'/api/pages/inbound-links?url=https://example.com/target&limit=0',
			);
			const body = (await res.json()) as { items: unknown[]; total: number };
			expect(body.total).toBe(2);
			expect(body.items).toHaveLength(0);
		});
	});

	describe('stub mode (live crawl — viewer_anchor_facts can never exist)', () => {
		it('responds with available: false instead of attempting a query that would throw', async () => {
			const fakeArchive = {} as unknown as Archive;
			const context: ArchiveContext = {
				manager: { get: () => fakeArchive } as unknown as ArchiveManager,
				archiveId: 'live-stub',
				filePath: '/tmp/._nitpicker-live',
				mode: 'stub',
				crawlerLockHolder: null,
			};
			const app = createApp({ context, publicDir: workingDir });
			const res = await app.request(
				'/api/pages/inbound-links?url=https://example.com/target',
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ available: false });
		});
	});
});
