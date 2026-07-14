import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDirectoryTree } from './get-directory-tree.js';
import { listDirectoryChildren } from './list-directory-children.js';
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

describe('listDirectoryChildren', () => {
	describe('no read model built', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_list_directory_children_no_model__',
		);
		const archiveFilePath = path.resolve(workingDir, 'no-model-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns an empty array rather than throwing', async () => {
			await expect(listDirectoryChildren(archive, { nodeId: 1 })).resolves.toEqual([]);
		});
	});

	describe('populated tree', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_list_directory_children__',
		);
		const archiveFilePath = path.resolve(workingDir, 'children-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			for (const url of [
				'https://example.com/',
				'https://example.com/a/b/c/d/page',
				'https://example.com/blog/2024/post-1',
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

		it("returns the depth-4 node beyond getDirectoryTree's initial depth<=3 cutoff", async () => {
			const roots = await getDirectoryTree(archive);
			const depth3 = roots[0]?.nodes.find((n) => n.path === '/a/b/c/');
			expect(depth3).toBeDefined();
			expect(roots[0]?.nodes.some((n) => n.path === '/a/b/c/d/')).toBe(false);

			const children = await listDirectoryChildren(archive, { nodeId: depth3!.nodeId });
			expect(children).toHaveLength(1);
			expect(children[0]).toMatchObject({ path: '/a/b/c/d/', depth: 4 });
		});

		it('orders children by name and returns [] for a leaf with no child directories', async () => {
			const [firstRoot] = await getDirectoryTree(archive);
			const nodes = firstRoot!.nodes;
			const blog = nodes.find((n) => n.path === '/blog/2024/')!;
			expect(await listDirectoryChildren(archive, { nodeId: blog.nodeId })).toEqual([]);

			const root = nodes.find((n) => n.path === '/')!;
			const rootChildren = await listDirectoryChildren(archive, { nodeId: root.nodeId });
			expect(rootChildren.map((c) => c.name)).toEqual(['a', 'blog']);
		});

		it('truncates to the given limit', async () => {
			const [firstRoot] = await getDirectoryTree(archive);
			const root = firstRoot!.nodes.find((n) => n.path === '/')!;
			const limited = await listDirectoryChildren(archive, {
				nodeId: root.nodeId,
				limit: 1,
			});
			expect(limited).toHaveLength(1);
		});
	});
});
