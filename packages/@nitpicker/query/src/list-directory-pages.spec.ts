import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDirectoryTree } from './get-directory-tree.js';
import { listDirectoryPages } from './list-directory-pages.js';
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

/**
 * Exhausts `/api/directory-tree/pages`-equivalent cursor pagination for one
 * `nodeId`, following only `nextCursor`, and returns every item collected —
 * mirrors `register-pages-route.spec.ts`'s `paginateAllViaNextCursor` helper
 * but against `listDirectoryPages` directly rather than over HTTP.
 * @param archive - The archive to query.
 * @param nodeId - The directory node to paginate.
 * @param limit - Page size per call.
 * @param maxPages - Safety cap on iterations, to fail fast instead of
 *   looping forever if `nextCursor` never becomes `null`.
 * @returns Every item across every page, in order.
 */
async function paginateAllDirectoryPages(
	archive: InstanceType<typeof Archive>,
	nodeId: number,
	limit: number,
	maxPages = 10,
) {
	const items: { url: string }[] = [];
	let cursor: string | undefined;
	for (let i = 0; i < maxPages; i++) {
		const result = await listDirectoryPages(archive, { nodeId, cursor, limit });
		items.push(...result.items);
		if (!result.nextCursor) {
			return items;
		}
		cursor = result.nextCursor;
	}
	throw new Error(`paginateAllDirectoryPages: exceeded maxPages (${maxPages})`);
}

describe('listDirectoryPages', () => {
	describe('no read model built', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_list_directory_pages_no_model__',
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

		it('returns an empty, terminated result rather than throwing', async () => {
			await expect(listDirectoryPages(archive, { nodeId: 1 })).resolves.toEqual({
				items: [],
				nextCursor: null,
			});
		});
	});

	describe('populated directory', () => {
		const workingDir = path.resolve(__dirname, '__test_fixtures_list_directory_pages__');
		const archiveFilePath = path.resolve(workingDir, 'pages-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
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
					html: '',
					meta: { ...META, title: url },
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

		it('returns an empty, terminated result for a node with zero direct pages (e.g. the root, which only has a /blog/ child dir)', async () => {
			const [firstRoot] = await getDirectoryTree(archive);
			const root = firstRoot!.nodes.find((n) => n.path === '/')!;
			await expect(listDirectoryPages(archive, { nodeId: root.nodeId })).resolves.toEqual(
				{
					items: [],
					nextCursor: null,
				},
			);
		});

		it('returns all 3 direct pages in one call when limit >= total', async () => {
			const [firstRoot] = await getDirectoryTree(archive);
			const blog = firstRoot!.nodes.find((n) => n.path === '/blog/')!;
			const result = await listDirectoryPages(archive, {
				nodeId: blog.nodeId,
				limit: 100,
			});
			expect(result.items.map((i) => i.url).toSorted()).toEqual(
				[
					'https://example.com/blog/post-a',
					'https://example.com/blog/post-b',
					'https://example.com/blog/post-c',
				].toSorted(),
			);
			expect(result.nextCursor).toBeNull();
		});

		it('paginates to exhaustion with limit=1, with no duplicates/gaps, ending in nextCursor: null', async () => {
			const [firstRoot] = await getDirectoryTree(archive);
			const blog = firstRoot!.nodes.find((n) => n.path === '/blog/')!;
			const items = await paginateAllDirectoryPages(archive, blog.nodeId, 1);
			expect(items.map((i) => i.url).toSorted()).toEqual(
				[
					'https://example.com/blog/post-a',
					'https://example.com/blog/post-b',
					'https://example.com/blog/post-c',
				].toSorted(),
			);
		});

		it('rejects a cursor minted for a different nodeId', async () => {
			const [firstRoot] = await getDirectoryTree(archive);
			const nodes = firstRoot!.nodes;
			const blog = nodes.find((n) => n.path === '/blog/')!;
			const root = nodes.find((n) => n.path === '/')!;
			const first = await listDirectoryPages(archive, { nodeId: blog.nodeId, limit: 1 });
			await expect(
				listDirectoryPages(archive, { nodeId: root.nodeId, cursor: first.nextCursor! }),
			).rejects.toThrow(/does not match/);
		});

		it('rejects a malformed cursor', async () => {
			await expect(
				listDirectoryPages(archive, { nodeId: 1, cursor: '%%%not-base64%%%' }),
			).rejects.toThrow(/not decodable/);
		});
	});
});
