import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
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

const NOOP_META = {
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
 * Builds a fixture archive with 2 internal HTML pages (one with security
 * headers, one without) and returns an in-process Hono app wired to it via
 * the same read-only-open path the real viewer uses.
 * @param workingDir - Unique scratch directory for this fixture.
 * @param withReadModel - Whether to build the `viewer_header_checks` read
 *   model before opening read-only (exercises the fast path) or leave it
 *   unbuilt (exercises the legacy fallback path).
 * @returns The app and manager — callers must close the manager in `afterAll`.
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
		url: parseUrl('https://example.com/a')!,
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 100,
		responseHeaders: {
			'Content-Security-Policy': "default-src 'self'",
			'X-Frame-Options': 'DENY',
			'X-Content-Type-Options': 'nosniff',
			'Strict-Transport-Security': 'max-age=63072000',
		},
		html: '',
		meta: NOOP_META,
		anchorList: [],
		imageList: [],
		isSkipped: false,
	});
	await archive.setPage({
		url: parseUrl('https://example.com/b')!,
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 100,
		responseHeaders: {},
		html: '',
		meta: NOOP_META,
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
		publicDir: '/tmp/no-such-dir-register-header-checks-route-spec',
	});
	return { app, manager };
}

describe('registerHeaderChecksRoute — /api/headers (integration)', () => {
	describe('fast path (viewer_header_checks read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_header_checks_route_fast__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
			await populateMigrationTables(archive);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns every header check with a cursor contract', async () => {
			const res = await fixture.app.request('/api/headers');
			const body = (await res.json()) as {
				items: { url: string; hasCSP: boolean }[];
				total: number;
				nextCursor: string | null;
				prevCursor: string | null;
			};
			expect(body.total).toBe(2);
			expect(body.items.map((i) => i.url)).toEqual([
				'https://example.com/a',
				'https://example.com/b',
			]);
			expect(body.nextCursor).toBeNull();
			expect(body.prevCursor).toBeNull();
		});

		it('filters by missingOnly via the fast path', async () => {
			const res = await fixture.app.request('/api/headers?missingOnly=true');
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(1);
			expect(body.items[0]!.url).toBe('https://example.com/b');
		});

		it('paginates forward via cursor/direction query params', async () => {
			const page1Res = await fixture.app.request('/api/headers?limit=1');
			const page1 = (await page1Res.json()) as {
				items: { url: string }[];
				nextCursor: string | null;
			};
			expect(page1.items.map((i) => i.url)).toEqual(['https://example.com/a']);
			expect(page1.nextCursor).not.toBeNull();

			const page2Res = await fixture.app.request(
				`/api/headers?limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`,
			);
			const page2 = (await page2Res.json()) as {
				items: { url: string }[];
				nextCursor: string | null;
			};
			expect(page2.items.map((i) => i.url)).toEqual(['https://example.com/b']);
			expect(page2.nextCursor).toBeNull();
		});

		it('forces the legacy fallback for a sortBy the fast path does not index', async () => {
			const res = await fixture.app.request('/api/headers?sortBy=hasCSP&sortOrder=desc');
			const body = (await res.json()) as { items: { url: string }[] };
			expect(body.items).toHaveLength(2);
		});
	});

	describe('legacy fallback path (no read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_header_checks_route_legacy__',
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

		it('returns the same shape via the legacy live query, with null cursors', async () => {
			const res = await fixture.app.request('/api/headers');
			const body = (await res.json()) as {
				items: { url: string }[];
				total: number;
				nextCursor: string | null;
				prevCursor: string | null;
			};
			expect(body.total).toBe(2);
			expect(body.items.map((i) => i.url)).toEqual([
				'https://example.com/a',
				'https://example.com/b',
			]);
			expect(body.nextCursor).toBeNull();
			expect(body.prevCursor).toBeNull();
		});
	});
});
