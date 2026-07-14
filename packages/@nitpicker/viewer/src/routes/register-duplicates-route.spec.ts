import type { Meta } from '@d-zero/beholder';

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

/**
 * Builds a minimal, valid beholder 3.0.0 {@link Meta} object, permitting a
 * partial subset of overrides (`title`/`description` are the only fields
 * this suite exercises).
 * @param overrides - Partial Meta-like object.
 * @returns A fully-populated `Meta` object.
 */
function makeMeta(overrides: Partial<Meta> = {}): Meta {
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
 * Builds a fixture archive with a `title` duplicate group of 3 pages
 * (`/a`, `/b`, `/c`), a `description` duplicate group of 2 pages (`/a`,
 * `/b`), and a control page (`/d`) with unique metadata, then returns an
 * in-process Hono app wired to it via the same read-only-open path the real
 * viewer uses.
 * @param workingDir - Unique scratch directory for this fixture.
 * @param withReadModel - Whether to build the `viewer_duplicate_groups`/
 *   `viewer_duplicate_group_pages` read model before opening read-only
 *   (exercises the fast path) or leave it unbuilt (exercises the legacy
 *   fallback path).
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

	const pages = [
		{ path: 'a', title: 'Same Title', description: 'Same Description' },
		{ path: 'b', title: 'Same Title', description: 'Same Description' },
		{ path: 'c', title: 'Same Title', description: 'Unique Description C' },
		{ path: 'd', title: 'Unique Title D', description: 'Unique Description D' },
	];
	for (const p of pages) {
		await archive.setPage({
			url: parseUrl(`https://example.com/${p.path}`)!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: makeMeta({ title: p.title, description: p.description }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	}

	await populateMigrationTables(archive);

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
		publicDir: '/tmp/no-such-dir-register-duplicates-route-spec',
	});
	return { app, manager };
}

describe('registerDuplicatesRoute — /api/duplicates (integration)', () => {
	describe('fast path (viewer_duplicate_groups read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_duplicates_route_fast__',
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

		it('lists title duplicate groups with an inline page sample', async () => {
			const res = await fixture.app.request('/api/duplicates?field=title');
			const body = (await res.json()) as {
				items: {
					groupId: number;
					field: string;
					value: string;
					count: number;
					pages: string[];
				}[];
				total: number;
				nextCursor: string | null;
			};
			expect(body.total).toBe(1);
			expect(body.items[0]).toMatchObject({
				groupId: 1,
				field: 'title',
				value: 'Same Title',
				count: 3,
			});
			expect(body.items[0]!.pages).toEqual([
				'https://example.com/a',
				'https://example.com/b',
				'https://example.com/c',
			]);
		});

		it('lists description duplicate groups', async () => {
			const res = await fixture.app.request('/api/duplicates?field=description');
			const body = (await res.json()) as {
				items: { groupId: number; value: string; count: number; pages: string[] }[];
				total: number;
			};
			expect(body.total).toBe(1);
			expect(body.items[0]).toMatchObject({
				groupId: 2,
				value: 'Same Description',
				count: 2,
			});
			expect(body.items[0]!.pages).toEqual([
				'https://example.com/a',
				'https://example.com/b',
			]);
		});

		it('rejects an unknown field with 400', async () => {
			const res = await fixture.app.request('/api/duplicates?field=bogus');
			expect(res.status).toBe(400);
		});

		it('paginates a group member-page list via /api/duplicates/:groupId/pages', async () => {
			const page1Res = await fixture.app.request('/api/duplicates/1/pages?limit=2');
			const page1 = (await page1Res.json()) as {
				items: string[];
				total: number;
				nextCursor: string | null;
			};
			expect(page1.total).toBe(3);
			expect(page1.items).toEqual(['https://example.com/a', 'https://example.com/b']);
			expect(page1.nextCursor).not.toBeNull();

			const page2Res = await fixture.app.request(
				`/api/duplicates/1/pages?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`,
			);
			const page2 = (await page2Res.json()) as {
				items: string[];
				nextCursor: string | null;
			};
			expect(page2.items).toEqual(['https://example.com/c']);
			expect(page2.nextCursor).toBeNull();
		});

		it('returns an empty page list for a non-existent groupId', async () => {
			const res = await fixture.app.request('/api/duplicates/999/pages');
			const body = (await res.json()) as { items: string[]; total: number };
			expect(body.total).toBe(0);
			expect(body.items).toEqual([]);
		});

		it('rejects a non-numeric groupId with 400', async () => {
			const res = await fixture.app.request('/api/duplicates/not-a-number/pages');
			expect(res.status).toBe(400);
		});

		it('rejects a non-positive groupId with 404 even though the read model IS current — it can only ever be a legacy-fallback sentinel', async () => {
			const zero = await fixture.app.request('/api/duplicates/0/pages');
			expect(zero.status).toBe(404);
			const negative = await fixture.app.request('/api/duplicates/-1/pages');
			expect(negative.status).toBe(404);
		});
	});

	describe('legacy fallback path (no read model built)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_duplicates_route_legacy__',
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
			const res = await fixture.app.request('/api/duplicates?field=title');
			const body = (await res.json()) as {
				items: { value: string; count: number }[];
				total: number;
				nextCursor: string | null;
				prevCursor: string | null;
			};
			expect(body.total).toBe(1);
			expect(body.items[0]).toMatchObject({ value: 'Same Title', count: 3 });
			expect(body.nextCursor).toBeNull();
			expect(body.prevCursor).toBeNull();
		});

		it('404s the group member-page list — groupId has no meaning without the read model', async () => {
			const res = await fixture.app.request('/api/duplicates/1/pages');
			expect(res.status).toBe(404);
		});
	});
});
