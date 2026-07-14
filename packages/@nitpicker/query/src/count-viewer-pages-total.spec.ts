import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { countViewerPagesTotal } from './count-viewer-pages-total.js';
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

describe('countViewerPagesTotal', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_count_viewer_pages_total__',
	);
	const archiveFilePath = path.resolve(workingDir, 'count-total-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'A' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/doc.pdf')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'application/pdf',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await buildViewerReadModel(archive);
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('counts only the default html/unknown view when unfiltered', async () => {
		const knex = archive.getKnex();
		expect(await countViewerPagesTotal(knex, {})).toBe(1);
	});

	it('counts a relaxed contentTypeCategory filter independently', async () => {
		const knex = archive.getKnex();
		expect(await countViewerPagesTotal(knex, { contentTypeCategory: 'pdf' })).toBe(1);
	});

	it('does not reuse the unconditional viewer_query_profiles default total (which counts every row, PDFs included)', async () => {
		const knex = archive.getKnex();
		const profile = await knex('viewer_query_profiles')
			.where({ scope: 'pages', profile_key: 'default' })
			.first('total');
		expect(Number(profile.total)).toBe(2);
		expect(await countViewerPagesTotal(knex, {})).toBe(1);
	});
});
