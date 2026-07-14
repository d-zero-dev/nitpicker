import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { populateMigrationTables } from './__test-utils__/populate-migration-tables.js';
import { getDirectoryTree } from './get-directory-tree.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

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

describe('getDirectoryTree', () => {
	describe('no read model built', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_get_directory_tree_no_model__',
		);
		const archiveFilePath = path.resolve(workingDir, 'no-model-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);
			await populateMigrationTables(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns an empty array rather than throwing', async () => {
			await expect(getDirectoryTree(archive)).resolves.toEqual([]);
		});
	});

	describe('populated tree', () => {
		const workingDir = path.resolve(__dirname, '__test_fixtures_get_directory_tree__');
		const archiveFilePath = path.resolve(workingDir, 'get-tree-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			for (const url of [
				'https://example.com/',
				'https://example.com/blog/2024/post-1',
				// 4 levels deep — must be EXCLUDED from getDirectoryTree's
				// depth<=3 initial load (still exists in the read model itself,
				// per build-directory-tree-rows.spec.ts / build-viewer-read-model.spec.ts).
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
					html: '',
					meta: META,
					anchorList: [],
					imageList: [],
					isSkipped: false,
				});
			}
			await buildViewerReadModel(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns exactly one root for the single qualifying host', async () => {
			const roots = await getDirectoryTree(archive);
			expect(roots).toHaveLength(1);
			expect(roots[0]?.rootKey).toBe('example.com');
		});

		it('only includes nodes with depth <= 3, ordered by path', async () => {
			const roots = await getDirectoryTree(archive);
			const [root] = roots;
			expect(root?.nodes.every((n) => n.depth <= 3)).toBe(true);
			expect(root?.nodes.some((n) => n.path === '/a/b/c/')).toBe(true);
			expect(root?.nodes.some((n) => n.path === '/a/b/c/d/')).toBe(false);
			const paths = root?.nodes.map((n) => n.path) ?? [];
			expect(paths).toEqual(paths.toSorted());
		});

		it('exposes childCount as directChildDirCount + directPageCount, so callers never need to derive it themselves', async () => {
			const roots = await getDirectoryTree(archive);
			const root = roots[0]?.nodes.find((n) => n.path === '/');
			// Hardcoded against the fixture, not recomputed from the same
			// formula the production code uses — root has 2 direct child dirs
			// (blog, a) and 1 direct page (the root URL itself).
			expect(root).toMatchObject({
				directChildDirCount: 2,
				directPageCount: 1,
				childCount: 3,
				hasChildren: true,
			});
		});
	});
});
