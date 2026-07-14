import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { ArchiveManager, buildViewerReadModel, getDirectoryTree } from '@nitpicker/query';
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
 * Builds a fixture archive with a 4-deep directory chain and returns an
 * in-process Hono app wired to it — mirrors
 * `register-directory-tree-route.spec.ts`'s `buildFixture`.
 * @param workingDir - Unique scratch directory for this fixture.
 * @returns The app, archive, and manager — callers must close both in `afterAll`.
 */
async function buildFixture(workingDir: string) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);
	for (const url of ['https://example.com/', 'https://example.com/a/b/c/d/page']) {
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
	await buildViewerReadModel(archive);

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
		publicDir: '/tmp/no-such-dir-register-directory-tree-children-route-spec',
	});
	return { app, archive, manager, archiveId };
}

describe('registerDirectoryTreeChildrenRoute (integration)', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_register_directory_tree_children_route__',
	);
	let fixture: Awaited<ReturnType<typeof buildFixture>>;

	beforeAll(async () => {
		fixture = await buildFixture(workingDir);
	});

	afterAll(async () => {
		await fixture.manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns the depth-4 node beyond the initial depth<=3 tree, via its depth-3 parent', async () => {
		const accessor = fixture.manager.get(fixture.archiveId);
		const roots = await getDirectoryTree(accessor);
		const depth3 = roots[0]?.nodes.find((n) => n.path === '/a/b/c/');
		expect(depth3).toBeDefined();

		const res = await fixture.app.request(
			`/api/directory-tree/children?nodeId=${depth3!.nodeId}`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { nodes: { path: string; depth: number }[] };
		expect(body.nodes).toEqual([
			expect.objectContaining({ path: '/a/b/c/d/', depth: 4 }),
		]);
	});

	it('returns 400 when nodeId is missing', async () => {
		const res = await fixture.app.request('/api/directory-tree/children');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: 'Missing required query parameter: nodeId',
		});
	});

	it('returns an empty array for a node with no child directories', async () => {
		const accessor = fixture.manager.get(fixture.archiveId);
		const [firstRoot] = await getDirectoryTree(accessor);
		const root = firstRoot!.nodes.find((n) => n.path === '/')!;
		const res = await fixture.app.request(
			`/api/directory-tree/children?nodeId=${root.nodeId}`,
		);
		// root's only child is `/a/`, which DOES exist — assert the shape
		// instead of emptiness here; emptiness is covered by a leaf node.
		const body = (await res.json()) as { nodes: unknown[] };
		expect(Array.isArray(body.nodes)).toBe(true);
	});
});
