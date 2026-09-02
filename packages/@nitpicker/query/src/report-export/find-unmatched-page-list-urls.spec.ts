import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from '../viewer-read-model/build-viewer-read-model.js';

import { findUnmatchedPageListUrls } from './find-unmatched-page-list-urls.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_find_unmatched_page_list_urls__',
);

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

describe('findUnmatchedPageListUrls', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'find-unmatched-page-list-urls-test.nitpicker',
	);

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/blog')!,
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
		await archive.setPage({
			url: parseUrl('https://example.com/file.pdf')!,
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
		await archive.setExternalPage({
			url: parseUrl('https://external.example.com/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
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

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty array when every URL matches a Page List row', async () => {
		const missing = await findUnmatchedPageListUrls(archive, [
			'https://example.com/blog',
		]);
		expect(missing).toEqual([]);
	});

	it('reports a URL the archive has never seen', async () => {
		const missing = await findUnmatchedPageListUrls(archive, [
			'https://example.com/nonexistent',
		]);
		expect(missing).toEqual(['https://example.com/nonexistent']);
	});

	it('reports a PDF URL as unmatched, even though it exists in the archive (outside the Page List scope)', async () => {
		const missing = await findUnmatchedPageListUrls(archive, [
			'https://example.com/file.pdf',
		]);
		expect(missing).toEqual(['https://example.com/file.pdf']);
	});

	it('reports an external URL as unmatched, even though it exists in the archive (outside the Page List scope)', async () => {
		const missing = await findUnmatchedPageListUrls(archive, [
			'https://external.example.com/',
		]);
		expect(missing).toEqual(['https://external.example.com/']);
	});

	it('returns only the subset that did not match, preserving no particular order requirement', async () => {
		const missing = await findUnmatchedPageListUrls(archive, [
			'https://example.com/blog',
			'https://example.com/nonexistent',
		]);
		expect(missing).toEqual(['https://example.com/nonexistent']);
	});

	it('returns an empty array for an empty input list without querying the database', async () => {
		await expect(findUnmatchedPageListUrls(archive, [])).resolves.toEqual([]);
	});
});
