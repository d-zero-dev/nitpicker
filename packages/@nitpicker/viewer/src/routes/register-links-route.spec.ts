import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { ArchiveManager, buildViewerReadModel } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../create-app.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

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

/**
 * Builds a fixture archive with 2 internal pages linking to the same
 * external destination (one page with 2 anchors, one with 1 — referrer
 * count must land on 2, not 3) and returns an in-process Hono app wired to
 * it via the same read-only-open path the real viewer uses, mirroring
 * `register-pages-route.spec.ts`'s `buildFixture` helper.
 * @param workingDir - Unique scratch directory for this fixture.
 * @param withReadModel - Whether to build the `viewer_external_links` read
 *   model before opening read-only (exercises the fast path) or leave it
 *   unbuilt (exercises the legacy fallback path).
 * @returns The app, archive, and manager — callers must close both in
 *   `afterAll`.
 */
async function buildFixture(workingDir: string, withReadModel: boolean) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);

	await archive.setPage({
		url: parseUrl('https://example.com/page-a')!,
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
				href: parseUrl('https://ads.example.com/')!,
				isExternal: true,
				title: null,
				textContent: 'Ad banner',
			},
			{
				href: parseUrl('https://ads.example.com/')!,
				isExternal: true,
				title: null,
				textContent: 'Ad footer',
			},
		],
		imageList: [],
		isSkipped: false,
	});
	await archive.setPage({
		url: parseUrl('https://example.com/page-b')!,
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
				href: parseUrl('https://ads.example.com/')!,
				isExternal: true,
				title: null,
				textContent: 'Ad sidebar',
			},
		],
		imageList: [],
		isSkipped: false,
	});
	await archive.setPage({
		url: parseUrl('https://ads.example.com/')!,
		redirectPaths: [],
		isExternal: true,
		isTarget: false,
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

	if (withReadModel) {
		await buildViewerReadModel(archive);
	}

	const manager = new ArchiveManager();
	const { archiveId, mode } = await manager.open(archive.tmpDir);
	const app = createApp({
		context: {
			manager,
			archiveId,
			filePath: archive.tmpDir,
			mode,
			crawlerLockHolder: null,
		},
		publicDir: '/tmp/no-such-dir-register-links-route-spec',
	});
	return { app, archive, manager };
}

describe('registerLinksRoute — /api/links?type=external (integration)', () => {
	describe('fast path (viewer_external_links read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_links_route_fast__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns the destination-deduped shape with the correct referrer count', async () => {
			const res = await fixture.app.request('/api/links?type=external');
			const body = (await res.json()) as {
				items: { destUrl: string; status: number | null; referrerCount: number }[];
				total: number;
			};
			expect(body.total).toBe(1);
			expect(body.items).toEqual([
				{ destUrl: 'https://ads.example.com', status: 200, referrerCount: 2 },
			]);
		});
	});

	describe('legacy fallback path (no read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_links_route_legacy__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, false);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns the same destination-deduped shape via the legacy live query', async () => {
			const res = await fixture.app.request('/api/links?type=external');
			const body = (await res.json()) as {
				items: { destUrl: string; status: number | null; referrerCount: number }[];
				total: number;
			};
			expect(body.total).toBe(1);
			expect(body.items).toEqual([
				{ destUrl: 'https://ads.example.com', status: 200, referrerCount: 2 },
			]);
		});
	});
});
