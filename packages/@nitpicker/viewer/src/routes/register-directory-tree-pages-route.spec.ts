import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
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
 * Builds a fixture archive with 3 pages under `/blog/` and returns an
 * in-process Hono app wired to it — mirrors
 * `register-directory-tree-route.spec.ts`'s `buildFixture`.
 * @param workingDir - Unique scratch directory for this fixture.
 * @returns The app, archive, manager, and `archiveId` — callers must close
 *   the manager in `afterAll`.
 */
async function buildFixture(workingDir: string) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);
	for (const url of [
		'https://example.com/blog/post-a',
		'https://example.com/blog/post-b',
		'https://example.com/blog/post-c',
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
			meta: { ...META, title: url },
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
		publicDir: '/tmp/no-such-dir-register-directory-tree-pages-route-spec',
	});
	return { app, archive, manager, archiveId };
}

/**
 * Drives `/api/directory-tree/pages?nodeId=...` to exhaustion via
 * `nextCursor` alone, collecting every item's URL in request order — mirrors
 * `register-pages-route.spec.ts`'s `paginateAllViaNextCursor`.
 * @param app - The in-process Hono app.
 * @param nodeId - The directory node to paginate.
 * @param limit - The page size.
 * @param maxPages - Safety cap so a broken "never terminates" regression
 *   fails the test instead of hanging.
 * @returns The concatenated URLs across every page, in order.
 */
async function paginateAllViaNextCursor(
	app: ReturnType<typeof createApp>,
	nodeId: number,
	limit: number,
	maxPages = 10,
): Promise<string[]> {
	const urls: string[] = [];
	let cursor: string | null = null;
	for (let page = 0; page < maxPages; page++) {
		const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
		const res = await app.request(
			`/api/directory-tree/pages?nodeId=${nodeId}&limit=${limit}${cursorParam}`,
		);
		const body = (await res.json()) as {
			items: { url: string }[];
			nextCursor: string | null;
		};
		urls.push(...body.items.map((i) => i.url));
		if (!body.nextCursor) {
			return urls;
		}
		cursor = body.nextCursor;
	}
	throw new Error(`paginateAllViaNextCursor: did not terminate within ${maxPages} pages`);
}

describe('registerDirectoryTreePagesRoute (integration)', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_register_directory_tree_pages_route__',
	);
	let fixture: Awaited<ReturnType<typeof buildFixture>>;

	beforeAll(async () => {
		fixture = await buildFixture(workingDir);
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		await fixture.manager.closeAll();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('paginates to completion via nextCursor with limit=1, no duplicates or gaps', async () => {
		const accessor = fixture.manager.get(fixture.archiveId);
		const [firstRoot] = await getDirectoryTree(accessor);
		const blog = firstRoot!.nodes.find((n) => n.path === '/blog/')!;

		const urls = await paginateAllViaNextCursor(fixture.app, blog.nodeId, 1);
		expect(urls.toSorted()).toEqual(
			[
				'https://example.com/blog/post-a',
				'https://example.com/blog/post-b',
				'https://example.com/blog/post-c',
			].toSorted(),
		);
	});

	it('returns 400 when nodeId is missing', async () => {
		const res = await fixture.app.request('/api/directory-tree/pages');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: 'Missing required query parameter: nodeId',
		});
	});
});
