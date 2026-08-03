import type { Meta } from '@d-zero/beholder';

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

/**
 * Builds a minimal, valid beholder 3.0.0 {@link Meta} object, permitting a
 * partial subset of overrides (`link.canonical` is the only nested field
 * this suite exercises).
 * @param overrides - Partial Meta-like object.
 * @returns A fully-populated `Meta` object.
 */
function makeMeta(overrides: Record<string, unknown> = {}): Meta {
	return {
		title: '',
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
		...overrides,
	} as Meta;
}

/**
 * Builds a fixture archive with 2 pages that have a canonical mismatch
 * (`/a`, `/c`) and 1 page that does not (`/b`), then returns an in-process
 * Hono app wired to it via the same read-only-open path the real viewer
 * uses.
 * @param workingDir - Unique scratch directory for this fixture.
 * @param withReadModel - Whether to build the `viewer_mismatches` read model
 *   before opening read-only (exercises the fast path) or leave it unbuilt
 *   (exercises the live fallback path).
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
		responseHeaders: {},
		html: '',
		meta: makeMeta({
			title: 'A',
			link: { canonical: 'https://example.com/canonical-a' },
		}),
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
		meta: makeMeta({ title: 'B' }),
		anchorList: [],
		imageList: [],
		isSkipped: false,
	});
	await archive.setPage({
		url: parseUrl('https://example.com/c')!,
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 100,
		responseHeaders: {},
		html: '',
		meta: makeMeta({
			title: 'C',
			link: { canonical: 'https://example.com/canonical-c' },
		}),
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
		publicDir: '/tmp/no-such-dir-register-mismatches-route-spec',
	});
	return { app, manager };
}

describe('registerMismatchesRoute — /api/mismatches (integration)', () => {
	describe('fast path (viewer_mismatches read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_mismatches_route_fast__',
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

		it('lists canonical mismatches with a cursor contract', async () => {
			const res = await fixture.app.request('/api/mismatches?type=canonical');
			const body = (await res.json()) as {
				items: {
					url: string;
					type: string;
					actual: string | null;
					expected: string | null;
				}[];
				total: number;
				nextCursor: string | null;
				prevCursor: string | null;
			};
			expect(body.total).toBe(2);
			expect(body.items.map((i) => i.url)).toEqual([
				'https://example.com/a',
				'https://example.com/c',
			]);
			expect(body.nextCursor).toBeNull();
			expect(body.prevCursor).toBeNull();
		});

		it('paginates forward via cursor/direction query params', async () => {
			const page1Res = await fixture.app.request(
				'/api/mismatches?type=canonical&limit=1',
			);
			const page1 = (await page1Res.json()) as {
				items: { url: string }[];
				nextCursor: string | null;
			};
			expect(page1.items.map((i) => i.url)).toEqual(['https://example.com/a']);
			expect(page1.nextCursor).not.toBeNull();

			const page2Res = await fixture.app.request(
				`/api/mismatches?type=canonical&limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`,
			);
			const page2 = (await page2Res.json()) as {
				items: { url: string }[];
				nextCursor: string | null;
			};
			expect(page2.items.map((i) => i.url)).toEqual(['https://example.com/c']);
			expect(page2.nextCursor).toBeNull();
		});

		it('forces the live fallback for an explicit sortBy', async () => {
			const res = await fixture.app.request(
				'/api/mismatches?type=canonical&sortBy=actual',
			);
			const body = (await res.json()) as { items: { url: string }[]; total: number };
			expect(body.total).toBe(2);
		});

		it('rejects an invalid type with 400', async () => {
			const res = await fixture.app.request('/api/mismatches?type=bogus');
			expect(res.status).toBe(400);
		});

		it('lists every type when type is omitted', async () => {
			const res = await fixture.app.request('/api/mismatches');
			expect(res.status).toBe(200);
			const body = (await res.json()) as { total: number };
			expect(body.total).toBe(2);
		});

		it('filters by an array of types, OR-ing them together', async () => {
			const res = await fixture.app.request(
				'/api/mismatches?type=canonical&type=og:title',
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { total: number };
			expect(body.total).toBe(2);
		});
	});

	describe('live fallback path (no read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_mismatches_route_live__',
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

		it('returns the same shape via the live query, with null cursors', async () => {
			const res = await fixture.app.request('/api/mismatches?type=canonical');
			const body = (await res.json()) as {
				items: { url: string }[];
				total: number;
				nextCursor: string | null;
				prevCursor: string | null;
			};
			expect(body.total).toBe(2);
			expect(body.items.map((i) => i.url)).toEqual([
				'https://example.com/a',
				'https://example.com/c',
			]);
			expect(body.nextCursor).toBeNull();
			expect(body.prevCursor).toBeNull();
		});

		it('defaults to canonical when type is omitted (live path has no OR/every-type equivalent)', async () => {
			const res = await fixture.app.request('/api/mismatches');
			const body = (await res.json()) as { total: number };
			expect(body.total).toBe(2);
		});

		it('narrows a multi-type selection to canonical (live path has no OR equivalent)', async () => {
			const res = await fixture.app.request(
				'/api/mismatches?type=canonical&type=og:title',
			);
			const body = (await res.json()) as { total: number };
			expect(body.total).toBe(2);
		});
	});
});
