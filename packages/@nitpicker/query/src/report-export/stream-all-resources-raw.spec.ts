import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { streamAllResourcesRaw } from './stream-all-resources-raw.js';

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
 * Drains every {@link streamAllResourcesRaw} chunk into a single flat array.
 * @param accessor - The archive accessor to query.
 * @param chunkSize - Forwarded to {@link streamAllResourcesRaw}.
 * @returns All chunks' rows, concatenated in scan order.
 */
async function collect(
	accessor: Parameters<typeof streamAllResourcesRaw>[0],
	chunkSize?: number,
) {
	const rows = [];
	for await (const chunk of streamAllResourcesRaw(accessor, chunkSize)) {
		rows.push(...chunk);
	}
	return rows;
}

describe('streamAllResourcesRaw', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_stream_all_resources_raw__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'stream-all-resources-raw-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Home' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/about')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'About' },
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
			compress: 'gzip',
			cdn: false,
			headers: null,
		});
		await archive.setResources({
			url: parseUrl('https://cdn.example.com/app.js')!,
			isExternal: true,
			isError: false,
			status: 404,
			statusText: 'Not Found',
			contentType: 'application/javascript',
			contentLength: 5000,
			compress: false,
			cdn: 'cloudflare',
			headers: null,
		});

		await archive.setResourcesReferrers({
			url: 'https://example.com',
			src: 'https://example.com/style.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/about',
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

	it('lists every resource', async () => {
		const rows = await collect(archive);
		expect(rows).toHaveLength(2);
	});

	it('counts distinct referrer pages', async () => {
		const rows = await collect(archive);
		const css = rows.find((row) => row.url === 'https://example.com/style.css')!;
		expect(css.referrerCount).toBe(2);
	});

	it('reports a zero referrer count for a resource nothing references', async () => {
		const rows = await collect(archive);
		const js = rows.find((row) => row.url === 'https://cdn.example.com/app.js')!;
		expect(js.referrerCount).toBe(0);
	});

	it('carries status, statusText, contentType, and contentLength verbatim', async () => {
		const rows = await collect(archive);
		const js = rows.find((row) => row.url === 'https://cdn.example.com/app.js')!;
		expect(js).toMatchObject({
			status: 404,
			statusText: 'Not Found',
			contentType: 'application/javascript',
			contentLength: 5000,
		});
	});

	it('is independent of chunk size', async () => {
		const baseline = await collect(archive);
		const chunked = await collect(archive, 1);
		const byId = (rows: typeof baseline) =>
			rows.toSorted((a, b) => a.resourceId - b.resourceId);
		expect(byId(chunked)).toEqual(byId(baseline));
	});

	it('throws on a non-positive chunkSize instead of hanging forever', async () => {
		await expect(collect(archive, 0)).rejects.toThrow(RangeError);
		await expect(collect(archive, -1)).rejects.toThrow(RangeError);
	});
});
