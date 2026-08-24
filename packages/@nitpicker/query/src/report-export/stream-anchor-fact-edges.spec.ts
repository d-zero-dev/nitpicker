import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from '../viewer-read-model/build-viewer-read-model.js';

import { streamAnchorFactEdges } from './stream-anchor-fact-edges.js';

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
 * Drains every {@link streamAnchorFactEdges} chunk into a single flat array.
 * @param accessor - The archive accessor to query.
 * @param chunkSize - Forwarded to {@link streamAnchorFactEdges}.
 * @returns All chunks' rows, concatenated in scan order.
 */
async function collect(
	accessor: Parameters<typeof streamAnchorFactEdges>[0],
	chunkSize?: number,
) {
	const rows = [];
	for await (const chunk of streamAnchorFactEdges(accessor, chunkSize)) {
		rows.push(...chunk);
	}
	return rows;
}

describe('streamAnchorFactEdges', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_stream_anchor_fact_edges__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'stream-anchor-fact-edges-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/referrer')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Referrer' },
			anchorList: [
				{
					href: parseUrl('https://example.com/old')!,
					isExternal: false,
					title: null,
					textContent: 'To old',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/target')!,
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

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('resolves destUrl to the redirect-resolved canonical, distinct from rawDestUrl', async () => {
		const rows = await collect(archive);
		const edge = rows.find((row) => row.sourceUrl === 'https://example.com/referrer')!;
		expect(edge.destUrl).toBe('https://example.com/target');
		expect(edge.rawDestUrl).toBe('https://example.com/old');
	});

	it('carries the resolved destination status/statusText/contentType', async () => {
		const rows = await collect(archive);
		const edge = rows.find((row) => row.sourceUrl === 'https://example.com/referrer')!;
		expect(edge.status).toBe(404);
		expect(edge.statusText).toBe('Not Found');
		expect(edge.contentType).toBe('text/html');
	});

	it('resolves anchor text via first_text_id', async () => {
		const rows = await collect(archive);
		const edge = rows.find((row) => row.sourceUrl === 'https://example.com/referrer')!;
		expect(edge.textContent).toBe('To old');
	});

	it('is independent of chunk size', async () => {
		const baseline = await collect(archive);
		const chunked = await collect(archive, 1);
		const bySource = (rows: typeof baseline) =>
			rows.toSorted((a, b) => a.sourceUrl.localeCompare(b.sourceUrl));
		expect(bySource(chunked)).toEqual(bySource(baseline));
	});

	it('throws on a non-positive chunkSize instead of hanging forever', async () => {
		await expect(collect(archive, 0)).rejects.toThrow(RangeError);
		await expect(collect(archive, -1)).rejects.toThrow(RangeError);
	});
});
