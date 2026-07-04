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
	'__test_fixtures_register_resource_referrers_route__',
);

const BASE_CONFIG = {
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
};

describe('registerResourceReferrersRoute — /api/resources/referrers (integration)', () => {
	let manager: ArchiveManager;
	let app: ReturnType<typeof createApp>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		const archive = await Archive.create({
			filePath: path.resolve(workingDir, 'fixture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(BASE_CONFIG);

		await archive.setResources({
			url: parseUrl('https://example.com/shared.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 500,
			compress: false,
			cdn: false,
			headers: {},
		});
		for (const name of ['page-a', 'page-b']) {
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
				meta: {
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
				},
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
			await archive.setResourcesReferrers({
				url: `https://example.com/${name}`,
				src: 'https://example.com/shared.css',
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
			publicDir: '/tmp/no-such-dir-register-resource-referrers-route-spec',
		});
	});

	afterAll(async () => {
		await manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('requires the resourceUrl query parameter', async () => {
		const res = await fixtureRequest('/api/resources/referrers');
		expect(res.status).toBe(400);
	});

	it('returns 404 for a resource that does not exist', async () => {
		const res = await fixtureRequest(
			'/api/resources/referrers?resourceUrl=https://example.com/missing.css',
		);
		expect(res.status).toBe(404);
	});

	it('returns every referrer within the default limit', async () => {
		const res = await fixtureRequest(
			'/api/resources/referrers?resourceUrl=https://example.com/shared.css',
		);
		const body = (await res.json()) as {
			resourceUrl: string;
			pageUrls: string[];
			total: number;
			nextCursor: string | null;
		};
		expect(body.total).toBe(2);
		expect(body.pageUrls).toHaveLength(2);
		expect(body.nextCursor).toBeNull();
	});

	it('bounds by the limit query parameter and continues via nextCursor', async () => {
		const first = await fixtureRequest(
			'/api/resources/referrers?resourceUrl=https://example.com/shared.css&limit=1',
		);
		const firstBody = (await first.json()) as {
			pageUrls: string[];
			nextCursor: string | null;
		};
		expect(firstBody.pageUrls).toHaveLength(1);
		expect(firstBody.nextCursor).not.toBeNull();

		const second = await fixtureRequest(
			`/api/resources/referrers?resourceUrl=https://example.com/shared.css&limit=1&cursor=${firstBody.nextCursor}`,
		);
		const secondBody = (await second.json()) as {
			pageUrls: string[];
			nextCursor: string | null;
		};
		expect(secondBody.pageUrls).toHaveLength(1);
		expect(secondBody.nextCursor).toBeNull();
	});

	/**
	 * Shorthand for `app.request(path)` bound to this describe block's shared
	 * fixture `app`.
	 * @param requestPath - The request path (with query string) to fetch.
	 * @returns The Hono `Response`.
	 */
	function fixtureRequest(requestPath: string) {
		return app.request(requestPath);
	}
});
