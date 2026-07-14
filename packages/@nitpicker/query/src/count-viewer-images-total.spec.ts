import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { countViewerImagesTotal } from './count-viewer-images-total.js';
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

const NOOP_META = {
	lang: null,
	title: 'Page',
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

describe('countViewerImagesTotal', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_count_viewer_images_total__',
	);
	const archiveFilePath = path.resolve(workingDir, 'count-images-total-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/page')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: NOOP_META,
			anchorList: [],
			imageList: [
				{
					src: 'https://example.com/a.png',
					currentSrc: 'https://example.com/a.png',
					alt: 'A',
					width: 100,
					height: 100,
					naturalWidth: 100,
					naturalHeight: 100,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="a.png" alt="A">',
				},
				{
					src: 'https://example.com/b.png',
					currentSrc: 'https://example.com/b.png',
					alt: '',
					width: 100,
					height: 100,
					naturalWidth: 100,
					naturalHeight: 100,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="b.png">',
				},
			],
			isSkipped: false,
		});

		await populateMigrationTables(archive);
		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('counts every image when unfiltered', async () => {
		const knex = archive.getKnex();
		expect(await countViewerImagesTotal(knex, {})).toBe(2);
	});

	it('counts only the matching missingAlt subset when filtered', async () => {
		const knex = archive.getKnex();
		expect(await countViewerImagesTotal(knex, { missingAlt: true })).toBe(1);
		expect(await countViewerImagesTotal(knex, { missingAlt: false })).toBe(1);
	});
});
