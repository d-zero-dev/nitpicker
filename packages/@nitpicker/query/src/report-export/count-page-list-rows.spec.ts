import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from '../viewer-read-model/build-viewer-read-model.js';

import { countPageListRows } from './count-page-list-rows.js';
import { streamPageListRows } from './stream-page-list-rows.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_count_page_list_rows__');

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.13.0',
	recursive: true,
	interval: 0,
	image: true,
	fetchExternal: false,
	parallels: 1,
	roots: ['https://example.com', 'https://other.example'],
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

describe('countPageListRows', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'count-page-list-rows-test.nitpicker');

	/**
	 * Streams the same row set and counts what came out, so a test can pin
	 * the count to the rows a report would actually render.
	 * @param directories - Directory-prefix filters to apply to both readers.
	 * @returns The number of streamed rows.
	 */
	async function streamedRowCount(directories?: readonly string[]): Promise<number> {
		let streamed = 0;
		const options = { directories, chunkSize: 2 };
		for await (const chunk of streamPageListRows(archive, options)) {
			streamed += chunk.length;
		}
		return streamed;
	}

	/**
	 * Stores one page in the fixture archive.
	 * @param url - The page's absolute URL.
	 * @param overrides - Fields to change from the internal-HTML default.
	 * @param overrides.isExternal
	 * @param overrides.contentType
	 */
	async function setPage(
		url: string,
		overrides: { isExternal?: boolean; contentType?: string } = {},
	): Promise<void> {
		await archive.setPage({
			url: parseUrl(url)!,
			redirectPaths: [],
			isExternal: overrides.isExternal ?? false,
			isTarget: !overrides.isExternal,
			status: 200,
			statusText: 'OK',
			contentType: overrides.contentType ?? 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	}

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await setPage('https://example.com/blog');
		await setPage('https://example.com/blog/post-1');
		await setPage('https://example.com/blogging/x');
		await setPage('https://example.com/news/a');
		await setPage('https://other.example/blog/post-2');
		await setPage('https://example.com/blog/report.pdf', {
			contentType: 'application/pdf',
		});
		await setPage('https://external.example/blog/post-3', { isExternal: true });

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('counts every internal HTML page when no directory is given', async () => {
		expect(await countPageListRows(archive)).toBe(5);
	});

	it('counts a pathname-only prefix across hosts', async () => {
		expect(await countPageListRows(archive, { directories: ['/blog'] })).toBe(3);
	});

	it('counts a host-scoped prefix', async () => {
		const total = await countPageListRows(archive, {
			directories: ['https://example.com/blog'],
		});
		expect(total).toBe(2);
	});

	it('counts the union of several filters', async () => {
		const total = await countPageListRows(archive, {
			directories: ['/news', '/blogging'],
		});
		expect(total).toBe(2);
	});

	it('counts 0 for a prefix no page lives under', async () => {
		expect(await countPageListRows(archive, { directories: ['/shop'] })).toBe(0);
	});

	it('agrees with the number of rows streamPageListRows yields', async () => {
		expect(await countPageListRows(archive)).toBe(await streamedRowCount());
		expect(await countPageListRows(archive, { directories: ['/blog'] })).toBe(
			await streamedRowCount(['/blog']),
		);
	});

	it('rejects an unusable filter instead of counting every page', async () => {
		const counting = countPageListRows(archive, { directories: ['file:///blog'] });
		await expect(counting).rejects.toThrow(TypeError);
	});
});
