import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from '../viewer-read-model/build-viewer-read-model.js';

import { getInboundReferrerUrlsByPageIds } from './get-inbound-referrer-urls-by-page-ids.js';

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

describe('getInboundReferrerUrlsByPageIds', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_get_inbound_referrer_urls_by_page_ids__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'get-inbound-referrer-urls-by-page-ids-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;
	let targetId: number;
	let lonelyId: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/referrer-a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Referrer A' },
			anchorList: [
				{
					href: parseUrl('https://example.com/target')!,
					isExternal: false,
					title: null,
					textContent: 'To target',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/referrer-b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Referrer B' },
			anchorList: [
				{
					href: parseUrl('https://example.com/target')!,
					isExternal: false,
					title: null,
					textContent: 'To target too',
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

		// Links through a redirect source (/old-target -> /target), for the
		// `redirectedFromUrl` field — matches the legacy report's
		// `[REDIRECTED FROM] ...` note.
		await archive.setPage({
			url: parseUrl('https://example.com/referrer-c')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Referrer C' },
			anchorList: [
				{
					href: parseUrl('https://example.com/old-target')!,
					isExternal: false,
					title: null,
					textContent: 'To old target',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setRedirect({
			url: parseUrl('https://example.com/old-target')!,
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

		await archive.setPage({
			url: parseUrl('https://example.com/lonely')!,
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

		const knex = archive.getKnex();
		const targetRow = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/target')
			.first();
		targetId = targetRow.id;
		const lonelyRow = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/lonely')
			.first();
		lonelyId = lonelyRow.id;

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty map for an empty page id list without querying', async () => {
		const result = await getInboundReferrerUrlsByPageIds(archive, []);
		expect(result.size).toBe(0);
	});

	it('lists every referrer page URL for a destination, with anchor text and no redirect', async () => {
		const result = await getInboundReferrerUrlsByPageIds(archive, [targetId]);
		const details = result.get(targetId)!;
		expect(details).toHaveLength(3);
		expect(details).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					url: 'https://example.com/referrer-a',
					textContent: 'To target',
					count: 1,
					redirectedFromUrl: null,
				}),
				expect.objectContaining({
					url: 'https://example.com/referrer-b',
					textContent: 'To target too',
					count: 1,
					redirectedFromUrl: null,
				}),
			]),
		);
	});

	it('sets redirectedFromUrl when the referrer linked through a redirect source', async () => {
		const result = await getInboundReferrerUrlsByPageIds(archive, [targetId]);
		const details = result.get(targetId)!;
		expect(details).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					url: 'https://example.com/referrer-c',
					textContent: 'To old target',
					count: 1,
					redirectedFromUrl: 'https://example.com/old-target',
				}),
			]),
		);
	});

	it('returns no entry for a page with no inbound links', async () => {
		const result = await getInboundReferrerUrlsByPageIds(archive, [lonelyId]);
		expect(result.has(lonelyId)).toBe(false);
	});
});
