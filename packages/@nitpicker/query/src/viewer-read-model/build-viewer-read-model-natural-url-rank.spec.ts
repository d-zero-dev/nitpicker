import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import Archive from '@nitpicker/archive/archive';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listPages } from '../list-pages.js';

import { buildViewerReadModel } from './build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.13.0',
	recursive: true,
	interval: 0,
	image: false,
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

/** The URLs in the order they must list: the directory page, its index pages, then the rest by value. */
const EXPECTED_ORDER = [
	'https://example.com',
	'https://example.com/docs/',
	'https://example.com/docs/index.html',
	'https://example.com/docs/index-ja.html',
	'https://example.com/docs/a1x',
	'https://example.com/docs/a9',
	'https://example.com/docs/a10',
	'https://example.com/docs/page2.html',
	'https://example.com/docs/page10.html',
];

describe('buildViewerReadModel — natural URL order end to end', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_build_viewer_read_model_natural_url_rank__',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'natural-url-rank.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(BASE_CONFIG);
		// Added in a scrambled order on purpose: nothing about insertion order
		// may leak into the listing.
		for (const url of [
			'https://example.com/docs/page10.html',
			'https://example.com/docs/a10',
			'https://example.com/docs/index-ja.html',
			'https://example.com/',
			'https://example.com/docs/page2.html',
			'https://example.com/docs/a1x',
			'https://example.com/docs/',
			'https://example.com/docs/a9',
			'https://example.com/docs/index.html',
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
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('stores natural_url_rank so that viewer_pages lists in the specified order', async () => {
		await buildViewerReadModel(archive);

		const rows = await archive
			.getKnex()('viewer_pages')
			.select('url', 'natural_url_rank')
			.orderBy('natural_url_rank', 'asc');

		expect(rows.map((row: { url: string }) => row.url)).toStrictEqual(EXPECTED_ORDER);
		expect(
			rows.map((row: { natural_url_rank: number }) => row.natural_url_rank),
		).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it('lists in the same order through the live path that has no read model', async () => {
		const { items } = await listPages(archive, { sortBy: 'url' });

		expect(items.map((page) => page.url)).toStrictEqual(EXPECTED_ORDER);
	});
});
