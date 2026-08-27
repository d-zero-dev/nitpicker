import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from '../viewer-read-model/build-viewer-read-model.js';

import { streamPageListRows } from './stream-page-list-rows.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_stream_page_list_rows__');

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
 * Drains every {@link streamPageListRows} chunk into a single flat array.
 * @param accessor - The archive accessor to query.
 * @param options - Forwarded to {@link streamPageListRows}.
 * @returns All chunks' rows, concatenated in scan order.
 */
async function collect(
	accessor: Parameters<typeof streamPageListRows>[0],
	options?: Parameters<typeof streamPageListRows>[1],
) {
	const rows = [];
	for await (const chunk of streamPageListRows(accessor, options)) {
		rows.push(...chunk);
	}
	return rows;
}

describe('streamPageListRows', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'stream-page-list-rows-test.nitpicker',
	);

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'B' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
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
			html: '',
			meta: { ...META, title: 'A' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/missing')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
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

	it('lists internal HTML pages, including 404s, and excludes externals', async () => {
		const rows = await collect(archive);
		expect(rows.map((r) => r.url)).toEqual([
			'https://example.com/a',
			'https://example.com/b',
			'https://example.com/missing',
		]);
		expect(rows.find((r) => r.url === 'https://example.com/missing')?.status).toBe(404);
	});

	it('carries pageId alongside the full PageListItem fields', async () => {
		const rows = await collect(archive);
		const row = rows.find((r) => r.url === 'https://example.com/a')!;
		expect(row.pageId).toEqual(expect.any(Number));
		expect(row.title).toBe('A');
		expect(row.protocol).toBe('https:');
		expect(row.hostname).toBe('example.com');
		expect(row.path1).toBe('/a');
	});

	it('is independent of chunk size', async () => {
		const baseline = await collect(archive);
		const chunked = await collect(archive, { chunkSize: 1 });
		expect(chunked.map((r) => r.url)).toEqual(baseline.map((r) => r.url));
		expect(chunked.map((r) => r.pageId)).toEqual(baseline.map((r) => r.pageId));
	});

	it('throws on a non-positive chunkSize instead of hanging forever', async () => {
		await expect(collect(archive, { chunkSize: 0 })).rejects.toThrow(RangeError);
		await expect(collect(archive, { chunkSize: -1 })).rejects.toThrow(RangeError);
		await expect(collect(archive, 0)).rejects.toThrow(RangeError);
	});

	it('narrows the sweep to the requested directories', async () => {
		const rows = await collect(archive, { directories: ['/a'] });
		expect(rows.map((row) => row.url)).toEqual(['https://example.com/a']);
	});

	it('yields no chunk at all when no page matches the directories', async () => {
		expect(await collect(archive, { directories: ['/absent'] })).toEqual([]);
	});
});
