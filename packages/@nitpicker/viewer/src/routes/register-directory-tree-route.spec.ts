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
 * Builds a fixture archive with a small directory tree (root + 2 depths +
 * one 4-deep chain) and returns an in-process Hono app wired to it via the
 * same read-only-open path the real viewer uses — mirrors
 * `register-pages-route.spec.ts`'s `buildFixture`.
 * @param workingDir - Unique scratch directory for this fixture.
 * @param withReadModel - Whether to build the viewer read model before
 *   opening read-only. Unlike `/api/pages`, directory-tree has no legacy
 *   fallback, so `false` exercises the "read model not built" empty-response
 *   path rather than an alternate query backend.
 * @returns The app, archive, and manager — callers must close both in `afterAll`.
 */
async function buildFixture(workingDir: string, withReadModel: boolean) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);
	for (const url of [
		'https://example.com/',
		'https://example.com/blog/2024/post-1',
		'https://example.com/a/b/c/d/page',
	]) {
		await archive.setPage({
			url: parseUrl(url)!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: META,
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
		publicDir: '/tmp/no-such-dir-register-directory-tree-route-spec',
	});
	return { app, archive, manager };
}

describe('registerDirectoryTreeRoute (integration)', () => {
	describe('read model built', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_directory_tree_route__',
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

		it('returns one root for example.com with only depth<=3 nodes', async () => {
			const res = await fixture.app.request('/api/directory-tree');
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				roots: { rootKey: string; nodes: { path: string; depth: number }[] }[];
			};
			expect(body.roots).toHaveLength(1);
			expect(body.roots[0]?.rootKey).toBe('example.com');
			expect(body.roots[0]?.nodes.every((n) => n.depth <= 3)).toBe(true);
			expect(body.roots[0]?.nodes.some((n) => n.path === '/a/b/c/')).toBe(true);
			expect(body.roots[0]?.nodes.some((n) => n.path === '/a/b/c/d/')).toBe(false);
		});

		it('exposes childCount (directChildDirCount + directPageCount) and precomputed descendantPageCount on the root node', async () => {
			const res = await fixture.app.request('/api/directory-tree');
			const body = (await res.json()) as {
				roots: {
					nodes: {
						path: string;
						directChildDirCount: number;
						directPageCount: number;
						childCount: number;
						descendantPageCount: number;
					}[];
				}[];
			};
			const root = body.roots[0]?.nodes.find((n) => n.path === '/');
			// Hardcoded against the fixture, not recomputed from the same
			// formula the production code uses — root has 2 direct child dirs
			// (blog, a) and 1 direct page (the root URL itself).
			expect(root).toMatchObject({
				directChildDirCount: 2,
				directPageCount: 1,
				childCount: 3,
				descendantPageCount: 3,
			});
		});
	});

	describe('read model not built', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_directory_tree_route_no_model__',
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

		it('returns an empty roots array rather than a 500', async () => {
			const res = await fixture.app.request('/api/directory-tree');
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ roots: [] });
		});
	});
});
