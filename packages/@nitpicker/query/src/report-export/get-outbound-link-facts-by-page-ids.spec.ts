import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from '../viewer-read-model/build-viewer-read-model.js';

import { getOutboundLinkFactsByPageIds } from './get-outbound-link-facts-by-page-ids.js';

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

describe('getOutboundLinkFactsByPageIds', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_get_outbound_link_facts_by_page_ids__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'get-outbound-link-facts-by-page-ids-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;
	let sourcePageId: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/source')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Source' },
			anchorList: [
				{
					href: parseUrl('https://example.com/broken')!,
					isExternal: false,
					title: null,
					textContent: 'Broken 1',
				},
				{
					href: parseUrl('https://example.com/broken')!,
					isExternal: false,
					title: null,
					textContent: 'Broken 2',
				},
				{
					href: parseUrl('https://example.com/ok')!,
					isExternal: false,
					title: null,
					textContent: 'OK link',
				},
				{
					href: parseUrl('https://external.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'External link',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/broken')!,
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
			url: parseUrl('https://example.com/ok')!,
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

		const knex = archive.getKnex();
		const row = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/source')
			.first();
		sourcePageId = row.id;

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
		const result = await getOutboundLinkFactsByPageIds(archive, []);
		expect(result.size).toBe(0);
	});

	it('sums occurrence counts for internal and external links separately', async () => {
		const result = await getOutboundLinkFactsByPageIds(archive, [sourcePageId]);
		const facts = result.get(sourcePageId)!;
		// 2 duplicate anchors to /broken + 1 to /ok = 3 internal occurrences.
		expect(facts.internalLinks).toBe(3);
		expect(facts.externalLinks).toBe(1);
	});

	it('counts a status >= 400 (excluding 401) as bad, at occurrence granularity', async () => {
		const result = await getOutboundLinkFactsByPageIds(archive, [sourcePageId]);
		const facts = result.get(sourcePageId)!;
		expect(facts.internalBadLinks).toBe(2);
		expect(facts.externalBadLinks).toBe(0);
	});

	it('returns no entry for a page with no outbound links', async () => {
		const knex = archive.getKnex();
		const okRow = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/ok')
			.first();
		const result = await getOutboundLinkFactsByPageIds(archive, [okRow.id]);
		expect(result.has(okRow.id)).toBe(false);
	});
});

/**
 * Isolated into its own archive/fixture: exercises `SQLITE_IN_CHUNK`
 * chunking directly against SQLite (not just `eachSplitted`'s own generic
 * chunk-splitting unit tests) with a page-id batch the same size as the
 * real caller that motivated this fix — `streamPageListRows`'s 2000-row
 * cursor chunk, which `create-page-list.ts` passes straight through to
 * `getOutboundLinkFactsByPageIds` per batch.
 *
 * Note this does NOT reproduce an actual "too many SQL variables" crash on
 * this runtime: the archive/query stack runs on `libsql`, whose modern
 * builds raise `SQLITE_MAX_VARIABLE_NUMBER` to 32766 (see
 * `resolve-url-refs.ts`'s docs) — comfortably above every fixed batch size
 * any caller in this codebase currently passes, 2000 included. Chunking at
 * `SQLITE_IN_CHUNK` (500) here matches the same defensive convention every
 * other `whereIn`-over-a-caller-supplied-array call site in this codebase
 * already follows (`collect-page-stylesheet-urls-by-page-id.ts`,
 * `get-existing-page-urls.ts`, etc.) — cheap insurance against a future
 * larger batch size or a non-libsql SQLite build with the classic 999
 * default, not a fix for a crash this test can actually trigger. What this
 * test *does* prove, and the reason it exists: a page-id batch spanning
 * multiple `SQLITE_IN_CHUNK`-sized chunks still returns complete,
 * correctly-merged results — no id lost or double-counted across the
 * chunk boundaries the real 2000-row batch size produces.
 *
 * Built with direct `viewer_anchor_facts` inserts rather than 2000
 * `archive.setPage()` calls, for a fast, focused fixture — batched at 50
 * rows per `INSERT` to stay under SQLite's variable limit for the *setup*
 * inserts too.
 */
describe('getOutboundLinkFactsByPageIds — chunked whereIn beyond SQLITE_IN_CHUNK', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_get_outbound_link_facts_by_page_ids_chunking__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'get-outbound-link-facts-by-page-ids-chunking-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;
	const SOURCE_PAGE_COUNT = 2000;
	const SYNTHETIC_PAGE_ID_OFFSET = 900_000;

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

		await buildViewerReadModel(archive);
		const knex = archive.getKnex();

		// Reused as source/dest/raw-dest for every synthetic edge below — the
		// URL text and dest page id are irrelevant to this test, which only
		// checks that every one of `SOURCE_PAGE_COUNT` distinct
		// `source_page_id`s comes back with the correct occurrence count.
		const urlRefRow = await knex('viewer_url_refs').select('id').first();
		const urlRefId: number = urlRefRow.id;

		const rows = Array.from({ length: SOURCE_PAGE_COUNT }, (_, i) => ({
			source_page_id: SYNTHETIC_PAGE_ID_OFFSET + i,
			dest_page_id: SYNTHETIC_PAGE_ID_OFFSET,
			source_url_ref_id: urlRefId,
			dest_url_ref_id: urlRefId,
			raw_dest_url_ref_id: urlRefId,
			status: 200,
			status_sort_key: 200,
			status_desc_key: -200,
			count: 1,
			is_broken: 0,
			is_external_link: 0,
		}));
		const INSERT_BATCH_SIZE = 50;
		for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
			await knex('viewer_anchor_facts').insert(
				rows.slice(start, start + INSERT_BATCH_SIZE),
			);
		}
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns every requested page id from a batch spanning multiple SQLITE_IN_CHUNK chunks', async () => {
		const pageIds = Array.from(
			{ length: SOURCE_PAGE_COUNT },
			(_, i) => SYNTHETIC_PAGE_ID_OFFSET + i,
		);
		const result = await getOutboundLinkFactsByPageIds(archive, pageIds);
		expect(result.size).toBe(SOURCE_PAGE_COUNT);
	});

	it('does not lose or double-count occurrences for ids split across chunk boundaries', async () => {
		const pageIds = Array.from(
			{ length: SOURCE_PAGE_COUNT },
			(_, i) => SYNTHETIC_PAGE_ID_OFFSET + i,
		);
		const result = await getOutboundLinkFactsByPageIds(archive, pageIds);
		// The first and last ids, plus every 500-row chunk boundary
		// (499/500, 999/1000, 1499/1500) — the ones most likely to be
		// mishandled by an off-by-one in the chunk-splitting boundary.
		for (const i of [0, 499, 500, 999, 1000, 1499, 1500, SOURCE_PAGE_COUNT - 1]) {
			const facts = result.get(SYNTHETIC_PAGE_ID_OFFSET + i)!;
			expect(facts.internalLinks).toBe(1);
		}
	});
});
