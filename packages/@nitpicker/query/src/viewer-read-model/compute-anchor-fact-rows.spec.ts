import type { AnchorFactInsertRow } from './types.js';
import type { Knex } from 'knex';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeAnchorFactRows } from './compute-anchor-fact-rows.js';

/**
 * Drains {@link computeAnchorFactRows}'s `source.id`-range chunks into a
 * single flat array, for tests that only care about the full result.
 * @param trx - An open Knex transaction.
 * @param chunkSize - Forwarded to {@link computeAnchorFactRows}.
 * @returns All chunks' rows, concatenated in range order.
 */
async function collectAnchorFactRows(
	trx: Knex,
	chunkSize?: number,
): Promise<AnchorFactInsertRow[]> {
	const rows: AnchorFactInsertRow[] = [];
	for await (const chunk of computeAnchorFactRows(trx, chunkSize)) {
		rows.push(...chunk);
	}
	return rows;
}

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.10.0',
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

describe('computeAnchorFactRows', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_anchor_fact_rows__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-anchor-fact-rows-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		// Page A: two anchors to /broken (same pair, must collapse to one
		// row with count=2), one anchor to ads.example.com (external).
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
			anchorList: [
				{
					href: parseUrl('https://example.com/broken')!,
					isExternal: false,
					title: null,
					textContent: 'Broken link 1',
				},
				{
					href: parseUrl('https://example.com/broken')!,
					isExternal: false,
					title: null,
					textContent: 'Broken link 2',
				},
				{
					href: parseUrl('https://ads.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Ad',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// Page B: anchor to a 403 destination (must NOT be flagged broken)
		// and a 500 destination (must NOT be flagged broken either).
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
			anchorList: [
				{
					href: parseUrl('https://example.com/forbidden')!,
					isExternal: false,
					title: null,
					textContent: 'Forbidden',
				},
				{
					href: parseUrl('https://example.com/server-error')!,
					isExternal: false,
					title: null,
					textContent: 'Server error',
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
			url: parseUrl('https://example.com/forbidden')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 403,
			statusText: 'Forbidden',
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
			url: parseUrl('https://example.com/server-error')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 500,
			statusText: 'Internal Server Error',
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
			url: parseUrl('https://ads.example.com/')!,
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
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('collapses duplicate anchors between the same (source,dest) pair into one row with count', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => collectAnchorFactRows(trx));
		const broken = rows.find(
			(row) => row.dest_url_sort_key === 'https://example.com/broken',
		);
		expect(broken).toMatchObject({ count: 2, is_broken: 1 });
	});

	it('flags only 404 destinations as broken, not 403 or 5xx', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => collectAnchorFactRows(trx));
		const forbidden = rows.find(
			(row) => row.dest_url_sort_key === 'https://example.com/forbidden',
		);
		const serverError = rows.find(
			(row) => row.dest_url_sort_key === 'https://example.com/server-error',
		);
		expect(forbidden).toMatchObject({ status: 403, is_broken: 0 });
		expect(serverError).toMatchObject({ status: 500, is_broken: 0 });
	});

	it('flags external destinations via is_external_link, not is_broken', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => collectAnchorFactRows(trx));
		const ads = rows.find((row) => row.dest_url_sort_key === 'https://ads.example.com');
		expect(ads).toMatchObject({ count: 1, is_broken: 0, is_external_link: 1 });
	});

	it('substitutes NULL_STATUS_SENTINEL only when status is null, never a real status', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => collectAnchorFactRows(trx));
		const broken = rows.find(
			(row) => row.dest_url_sort_key === 'https://example.com/broken',
		)!;
		expect(broken.status_sort_key).toBe(404);
	});

	it('sets status_desc_key to the negation of status_sort_key', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => collectAnchorFactRows(trx));
		const broken = rows.find(
			(row) => row.dest_url_sort_key === 'https://example.com/broken',
		)!;
		expect(broken.status_desc_key).toBe(-404);
	});
});

/**
 * Mirrors `list-links.spec.ts`'s redirect-resolution describe block: an
 * anchor to an internal redirect-source page and an anchor directly to the
 * same canonical destination must collapse into a single row (same
 * dest_page_id), not two, and the broken/external judgment must use the
 * canonical destination, not the literal redirect-source.
 */
describe('computeAnchorFactRows — redirect resolution', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_anchor_fact_rows_redirect__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-anchor-fact-rows-redirect-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/direct')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Direct' },
			anchorList: [
				{
					href: parseUrl('https://example.com/canonical-target')!,
					isExternal: false,
					title: null,
					textContent: 'Direct link',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/via-redirect')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Via redirect' },
			anchorList: [
				{
					href: parseUrl('https://example.com/old')!,
					isExternal: false,
					title: null,
					textContent: 'Old link',
					hash: null,
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/canonical-target')!,
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
			redirectPaths: ['https://example.com/canonical-target'],
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
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('collapses a redirect-source anchor and a direct anchor onto the same canonical dest_page_id, judged broken via the canonical status', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => collectAnchorFactRows(trx));
		const targetRows = rows.filter(
			(row) => row.dest_url_sort_key === 'https://example.com/canonical-target',
		);
		expect(targetRows).toHaveLength(2);
		expect(new Set(targetRows.map((row) => row.dest_page_id)).size).toBe(1);
		for (const row of targetRows) {
			expect(row).toMatchObject({ status: 404, is_broken: 1, count: 1 });
		}
	});
});

/**
 * Mirrors the internal-destination redirect-resolution block above, but for
 * a canonical destination that is itself external — `is_external_link` must
 * come from the canonical page's `isExternal`, not the (always-internal)
 * redirect-source page's, and the two anchors (one direct, one via an
 * internal redirect-source) must still collapse onto one `dest_page_id`.
 */
describe('computeAnchorFactRows — redirect resolution to an external destination', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_anchor_fact_rows_redirect_external__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-anchor-fact-rows-redirect-external-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/direct-ext')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Direct ext' },
			anchorList: [
				{
					href: parseUrl('https://external.example.com/target')!,
					isExternal: true,
					title: null,
					textContent: 'Direct external link',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/via-redirect-ext')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Via redirect ext' },
			anchorList: [
				{
					href: parseUrl('https://example.com/old-ext')!,
					isExternal: false,
					title: null,
					textContent: 'Old external link',
					hash: null,
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://external.example.com/target')!,
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

		await archive.setRedirect({
			url: parseUrl('https://example.com/old-ext')!,
			redirectPaths: ['https://external.example.com/target'],
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
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('collapses a redirect-source anchor and a direct anchor onto the same external canonical dest_page_id, flagged external via the canonical page', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => collectAnchorFactRows(trx));
		const targetRows = rows.filter(
			(row) => row.dest_url_sort_key === 'https://external.example.com/target',
		);
		expect(targetRows).toHaveLength(2);
		expect(new Set(targetRows.map((row) => row.dest_page_id)).size).toBe(1);
		for (const row of targetRows) {
			expect(row).toMatchObject({
				status: 200,
				is_broken: 0,
				is_external_link: 1,
				count: 1,
			});
		}
	});
});

/**
 * Exercises the `source.id`-range chunking itself: a single page with
 * several distinct destinations must never have its `(source_page_id,
 * dest_page_id)` groups split or dropped across chunk boundaries. This is
 * the property a naive `ORDER BY source.id LIMIT n` keyset cursor (as used
 * for `computeResourceInsertRows`, where it's safe) would violate for this
 * function's compound `GROUP BY` — see `compute-anchor-fact-rows.ts`'s docs.
 */
describe('computeAnchorFactRows — chunking', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_anchor_fact_rows_chunking__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-anchor-fact-rows-chunking-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		// One page linking to 3 distinct destinations — under chunkSize=1
		// (one source.id per range) this page's 3 groups must all surface
		// from the single range query that covers it, not get truncated.
		await archive.setPage({
			url: parseUrl('https://example.com/hub')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Hub' },
			anchorList: [
				{
					href: parseUrl('https://example.com/dest-1')!,
					isExternal: false,
					title: null,
					textContent: 'Dest 1',
				},
				{
					href: parseUrl('https://example.com/dest-2')!,
					isExternal: false,
					title: null,
					textContent: 'Dest 2',
				},
				{
					href: parseUrl('https://example.com/dest-3')!,
					isExternal: false,
					title: null,
					textContent: 'Dest 3',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		for (const slug of ['dest-1', 'dest-2', 'dest-3']) {
			await archive.setPage({
				url: parseUrl(`https://example.com/${slug}`)!,
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
		}
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('keeps all destination groups for one source page together even with chunkSize=1', async () => {
		const knex = archive.getKnex();
		const baseline = await knex.transaction((trx) => collectAnchorFactRows(trx));
		const chunked = await knex.transaction((trx) => collectAnchorFactRows(trx, 1));
		const byDest = (rows: AnchorFactInsertRow[]) =>
			rows.toSorted((a, b) => a.dest_page_id - b.dest_page_id);
		expect(byDest(chunked)).toEqual(byDest(baseline));
		expect(chunked).toHaveLength(3);
	});

	it('throws on a non-positive chunkSize instead of hanging forever', async () => {
		const knex = archive.getKnex();
		await expect(
			knex.transaction((trx) => collectAnchorFactRows(trx, 0)),
		).rejects.toThrow(RangeError);
		await expect(
			knex.transaction((trx) => collectAnchorFactRows(trx, -1)),
		).rejects.toThrow(RangeError);
	});
});
