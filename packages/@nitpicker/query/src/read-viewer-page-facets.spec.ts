import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readViewerPageFacets } from './read-viewer-page-facets.js';
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

describe('readViewerPageFacets', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_read_viewer_page_facets__');
	const archiveFilePath = path.resolve(workingDir, 'read-facets-test.nitpicker');
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
			meta: { ...META, title: 'A', lang: 'ja' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.net/b')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, lang: 'en' },
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
			meta: { ...META, lang: 'fr' },
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

	it('resolves the default (html ∪ unknown) scope when contentTypeCategory is omitted', async () => {
		const knex = archive.getKnex();
		expect(await readViewerPageFacets(knex)).toEqual({
			statuses: [200, 404],
			langs: ['en', 'ja'],
			types: [false, true],
		});
	});

	it('scopes to an explicit contentTypeCategory, excluding rows from other categories', async () => {
		const knex = archive.getKnex();
		expect(await readViewerPageFacets(knex, 'pdf')).toEqual({
			statuses: [200],
			langs: ['fr'],
			types: [false],
		});
	});

	it('returns empty arrays (not an error) for a category with no matching rows', async () => {
		const knex = archive.getKnex();
		expect(await readViewerPageFacets(knex, 'image')).toEqual({
			statuses: [],
			langs: [],
			types: [],
		});
	});
});
