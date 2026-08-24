import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { streamAllContentItems } from './stream-all-content-items.js';

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
 * Drains every {@link streamAllContentItems} chunk into a single flat array.
 * @param accessor - The archive accessor to query.
 * @param chunkSize - Forwarded to {@link streamAllContentItems}.
 * @returns All chunks' rows, concatenated in scan order.
 */
async function collect(
	accessor: Parameters<typeof streamAllContentItems>[0],
	chunkSize?: number,
) {
	const rows = [];
	for await (const chunk of streamAllContentItems(accessor, chunkSize)) {
		rows.push(...chunk);
	}
	return rows;
}

describe('streamAllContentItems', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_stream_all_content_items__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'stream-all-content-items-test.nitpicker',
	);
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
			responseHeaders: { 'x-frame-options': 'DENY' },
			html: '',
			meta: { ...META, title: 'Page' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/target')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Target' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setRedirect({
			url: parseUrl('https://example.com/old')!,
			redirectPaths: ['https://example.com/target'],
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

		await archive.setSkippedPage('https://example.com/blocked', 'excluded');
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('includes skipped pages, unlike listPages', async () => {
		const rows = await collect(archive);
		const blocked = rows.find((row) => row.url === 'https://example.com/blocked');
		expect(blocked).toBeDefined();
		expect(blocked).toMatchObject({ isSkipped: true, skipReason: 'excluded' });
	});

	it('resolves response headers for a page with a header set', async () => {
		const rows = await collect(archive);
		const page = rows.find((row) => row.url === 'https://example.com/page')!;
		expect(page.responseHeaders).toMatchObject({ 'x-frame-options': 'DENY' });
	});

	it('returns an empty headers object for a page with no header set', async () => {
		const rows = await collect(archive);
		const target = rows.find((row) => row.url === 'https://example.com/target')!;
		expect(target.responseHeaders).toEqual({});
	});

	it('lists redirect-from URLs for a redirect destination', async () => {
		const rows = await collect(archive);
		const target = rows.find((row) => row.url === 'https://example.com/target')!;
		expect(target.redirectFromUrls).toEqual(['https://example.com/old']);
	});

	it('leaves redirectFromUrls empty for a page nothing redirects to', async () => {
		const rows = await collect(archive);
		const page = rows.find((row) => row.url === 'https://example.com/page')!;
		expect(page.redirectFromUrls).toEqual([]);
	});

	it('is independent of chunk size', async () => {
		const baseline = await collect(archive);
		const chunked = await collect(archive, 1);
		const byUrl = (rows: typeof baseline) =>
			rows.toSorted((a, b) => a.url.localeCompare(b.url));
		expect(byUrl(chunked)).toEqual(byUrl(baseline));
	});

	it('throws on a non-positive chunkSize instead of hanging forever', async () => {
		await expect(collect(archive, 0)).rejects.toThrow(RangeError);
		await expect(collect(archive, -1)).rejects.toThrow(RangeError);
	});
});
