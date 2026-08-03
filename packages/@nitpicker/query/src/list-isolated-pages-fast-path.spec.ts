import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listIsolatedPagesFastPath } from './list-isolated-pages-fast-path.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const dirname = path.dirname(new URL(import.meta.url).pathname);

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
 * Builds a fixture archive with three singleton (unlinked) inventory-*
 * pages spanning two statuses and two sources, so `status`/`source` array
 * filters have distinguishable subsets to OR across.
 * @param workingDir - Unique scratch directory for this fixture.
 * @returns The opened archive — caller closes it in `afterAll`.
 */
async function buildFixtureArchive(
	workingDir: string,
): Promise<InstanceType<typeof Archive>> {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);

	await archive.setPage(
		{
			url: parseUrl('https://example.com/solo-1')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Solo 1' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		},
		'inventory-seed',
	);
	await archive.setPage(
		{
			url: parseUrl('https://example.com/solo-2')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Solo 2' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		},
		'inventory-discovered',
	);
	await archive.setPage(
		{
			url: parseUrl('https://example.com/solo-3')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 500,
			statusText: 'Internal Server Error',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Solo 3' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		},
		'inventory-seed',
	);

	return archive;
}

describe('listIsolatedPagesFastPath', () => {
	describe('read model built (fast path)', () => {
		const workingDir = path.resolve(
			dirname,
			'__test_fixtures_list_isolated_pages_fast_path_current__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			archive = await buildFixtureArchive(workingDir);
			await buildViewerReadModel(archive);
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('keeps the single-value status filter working', async () => {
			const result = await listIsolatedPagesFastPath(archive, { status: 200 });
			expect(result.total).toBe(1);
			expect(result.items[0]!.url).toBe('https://example.com/solo-1');
		});

		it('OR-filters across a status array', async () => {
			const result = await listIsolatedPagesFastPath(archive, { status: [200, 404] });
			expect(result.total).toBe(2);
			expect(result.items.map((i) => i.url).toSorted()).toEqual([
				'https://example.com/solo-1',
				'https://example.com/solo-2',
			]);
		});

		it('OR-filters across a source array', async () => {
			const singleSource = await listIsolatedPagesFastPath(archive, {
				source: ['inventory-seed'],
			});
			expect(singleSource.total).toBe(2);

			const bothSources = await listIsolatedPagesFastPath(archive, {
				source: ['inventory-seed', 'inventory-discovered'],
			});
			expect(bothSources.total).toBe(3);
		});
	});

	describe('read model absent (live fallback)', () => {
		const workingDir = path.resolve(
			dirname,
			'__test_fixtures_list_isolated_pages_fast_path_live__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			archive = await buildFixtureArchive(workingDir);
			// Deliberately skip buildViewerReadModel — isViewerReadModelCurrent
			// reports false, forcing the live listIsolatedPages branch.
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('degrades a status array to its first element instead of throwing or matching nothing', async () => {
			const result = await listIsolatedPagesFastPath(archive, { status: [200, 404] });
			expect(result.total).toBe(1);
			expect(result.items[0]!.url).toBe('https://example.com/solo-1');
		});

		it('degrades a source array to its first element instead of throwing or matching nothing', async () => {
			const result = await listIsolatedPagesFastPath(archive, {
				source: ['inventory-discovered', 'inventory-seed'],
			});
			expect(result.total).toBe(1);
			expect(result.items[0]!.url).toBe('https://example.com/solo-2');
		});
	});
});
