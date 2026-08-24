import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { streamResourceReferrerEdges } from './stream-resource-referrer-edges.js';

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
 * Drains every {@link streamResourceReferrerEdges} chunk into a flat array.
 * @param accessor - The archive accessor to query.
 * @param chunkSize - Forwarded to {@link streamResourceReferrerEdges}.
 * @returns All chunks' rows, concatenated in scan order.
 */
async function collect(
	accessor: Parameters<typeof streamResourceReferrerEdges>[0],
	chunkSize?: number,
) {
	const rows = [];
	for await (const chunk of streamResourceReferrerEdges(accessor, chunkSize)) {
		rows.push(...chunk);
	}
	return rows;
}

describe('streamResourceReferrerEdges', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_stream_resource_referrer_edges__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'stream-resource-referrer-edges-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/page-a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Page A' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/page-b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Page B' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setResources({
			url: parseUrl('https://example.com/style.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 1000,
			compress: false,
			cdn: false,
			headers: null,
		});

		await archive.setResourcesReferrers({
			url: 'https://example.com/page-a',
			src: 'https://example.com/style.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/page-b',
			src: 'https://example.com/style.css',
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('produces one row per (resource, referring page) pair', async () => {
		const rows = await collect(archive);
		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.pageUrl).toSorted()).toEqual([
			'https://example.com/page-a',
			'https://example.com/page-b',
		]);
	});

	it('carries the resource metadata on every row', async () => {
		const rows = await collect(archive);
		for (const row of rows) {
			expect(row).toMatchObject({
				resourceUrl: 'https://example.com/style.css',
				status: 200,
				statusText: 'OK',
				contentType: 'text/css',
				contentLength: 1000,
			});
		}
	});

	it('is independent of chunk size (exercises the composite-key tuple cursor)', async () => {
		const baseline = await collect(archive);
		const chunked = await collect(archive, 1);
		const byPageUrl = (rows: typeof baseline) =>
			rows.toSorted((a, b) => a.pageUrl.localeCompare(b.pageUrl));
		expect(byPageUrl(chunked)).toEqual(byPageUrl(baseline));
	});

	it('throws on a non-positive chunkSize instead of hanging forever', async () => {
		await expect(collect(archive, 0)).rejects.toThrow(RangeError);
		await expect(collect(archive, -1)).rejects.toThrow(RangeError);
	});
});
