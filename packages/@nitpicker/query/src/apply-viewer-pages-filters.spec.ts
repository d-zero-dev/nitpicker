import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyViewerPagesFilters } from './apply-viewer-pages-filters.js';
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

describe('applyViewerPagesFilters', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_pages_filters__',
	);
	const archiveFilePath = path.resolve(workingDir, 'apply-filters-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/html-internal')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Home' },
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

	it('defaults to the html/unknown content_category restriction when no category filter is given', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, {});
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/html-internal']);
	});

	it('relaxes the default restriction when an explicit contentTypeCategory is given', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyViewerPagesFilters(qb, { contentTypeCategory: 'pdf' });
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/doc.pdf']);
	});
});
