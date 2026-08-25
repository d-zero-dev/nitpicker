import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeResourceGroupRows } from './compute-resource-group-rows.js';

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

describe('computeResourceGroupRows', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_resource_group_rows__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-resource-group-rows-test.nitpicker',
	);

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

		// Two raw resources that canonicalize to the same group
		// (https://example.com/tracker.js?id) — a tracking pixel with a
		// per-request unique query value.
		await archive.setResources({
			url: parseUrl('https://example.com/tracker.js?id=1')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 100,
			compress: false,
			cdn: false,
			headers: {},
		});
		await archive.setResources({
			url: parseUrl('https://example.com/tracker.js?id=2')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 300,
			compress: false,
			cdn: false,
			headers: {},
		});
		// Page A references both raw variants; Page B references only the
		// first. The group's referrer_count must be 2 (distinct pages), not 3
		// (raw edge count) — this is the "union across constituent raw
		// resources" behavior this function exists to get right.
		await archive.setResourcesReferrers({
			url: 'https://example.com/page-a',
			src: 'https://example.com/tracker.js?id=1',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/page-a',
			src: 'https://example.com/tracker.js?id=2',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/page-b',
			src: 'https://example.com/tracker.js?id=1',
		});

		// A distinct resource with no query string and no referrers.
		await archive.setResources({
			url: parseUrl('https://example.com/style.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 50,
			compress: false,
			cdn: false,
			headers: {},
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('collapses raw resources sharing a canonical URL into one group', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeResourceGroupRows(trx));
		const trackerGroup = rows.find(
			(r) => r.canonical_url === 'https://example.com/tracker.js?id',
		);
		expect(trackerGroup).toBeDefined();
		expect(trackerGroup!.count).toBe(2);
	});

	it('computes an exact referrer_count as the union of referring pages across constituent raw resources', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeResourceGroupRows(trx));
		const trackerGroup = rows.find(
			(r) => r.canonical_url === 'https://example.com/tracker.js?id',
		)!;
		expect(trackerGroup.referrer_count).toBe(2);
	});

	it('includes referrer page URLs in the note', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeResourceGroupRows(trx));
		const trackerGroup = rows.find(
			(r) => r.canonical_url === 'https://example.com/tracker.js?id',
		)!;
		expect(trackerGroup.referrer_note).toContain('https://example.com/page-a');
		expect(trackerGroup.referrer_note).toContain('https://example.com/page-b');
	});

	it('formats query_pattern as key=N with the distinct sampled value count', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeResourceGroupRows(trx));
		const trackerGroup = rows.find(
			(r) => r.canonical_url === 'https://example.com/tracker.js?id',
		)!;
		expect(trackerGroup.query_pattern).toBe('id=2');
	});

	it('returns null query_pattern for a group with no query string', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeResourceGroupRows(trx));
		const styleGroup = rows.find(
			(r) => r.canonical_url === 'https://example.com/style.css',
		)!;
		expect(styleGroup.query_pattern).toBeNull();
	});

	it('returns null referrer_note and referrer_count 0 for a group with no referrers', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeResourceGroupRows(trx));
		const styleGroup = rows.find(
			(r) => r.canonical_url === 'https://example.com/style.css',
		)!;
		expect(styleGroup.referrer_count).toBe(0);
		expect(styleGroup.referrer_note).toBeNull();
	});

	it('computes content_length_min/max across the group', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeResourceGroupRows(trx));
		const trackerGroup = rows.find(
			(r) => r.canonical_url === 'https://example.com/tracker.js?id',
		)!;
		expect(trackerGroup.content_length_min).toBe(100);
		expect(trackerGroup.content_length_max).toBe(300);
	});

	it('sorts groups by canonical URL in natural order', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeResourceGroupRows(trx));
		const urls = rows.map((r) => r.canonical_url);
		expect(urls).toEqual([...urls].toSorted());
	});

	it('reads across multiple chunkSize-bounded chunks without losing or duplicating groups', async () => {
		const knex = archive.getKnex();
		const baseline = await knex.transaction((trx) => computeResourceGroupRows(trx));
		const chunked = await knex.transaction((trx) => computeResourceGroupRows(trx, 1));
		const byUrl = (rows: typeof baseline) =>
			rows.toSorted((a, b) => a.canonical_url.localeCompare(b.canonical_url));
		expect(byUrl(chunked)).toEqual(byUrl(baseline));
	});

	it('throws on a non-positive chunkSize instead of silently yielding nothing or looping forever', async () => {
		const knex = archive.getKnex();
		await expect(
			knex.transaction((trx) => computeResourceGroupRows(trx, 0)),
		).rejects.toThrow(RangeError);
		await expect(
			knex.transaction((trx) => computeResourceGroupRows(trx, -1)),
		).rejects.toThrow(RangeError);
	});

	it('reports keyset scan progress up to the max resource_items id (issue #294)', async () => {
		const knex = archive.getKnex();
		const calls: [number, number][] = [];
		await knex.transaction((trx) =>
			computeResourceGroupRows(trx, 1, (scannedUpToId, maxId) => {
				calls.push([scannedUpToId, maxId]);
			}),
		);

		expect(calls.length).toBeGreaterThan(0);
		const maxId = calls[0]![1];
		expect(maxId).toBeGreaterThan(0);
		for (const [scannedUpToId, total] of calls) {
			expect(total).toBe(maxId);
			expect(scannedUpToId).toBeLessThanOrEqual(maxId);
		}
		expect(calls.at(-1)![0]).toBe(maxId);
	});
});

/**
 * Isolated into its own archive/fixture: exercises the referrer-sample cap
 * (a resource referenced by more distinct pages than the note's sample
 * limit), which needs 201 distinct referring pages — built with direct
 * `url_refs`/`content_items`/`resource_ref_edges` inserts rather than 201
 * `archive.setPage()` calls, for a fast, focused fixture.
 */
describe('computeResourceGroupRows — referrer sample cap', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_resource_group_rows_referrer_cap__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-resource-group-rows-referrer-cap-test.nitpicker',
	);
	const REFERRER_COUNT = 201;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setResources({
			url: parseUrl('https://example.com/widely-used.js')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 100,
			compress: false,
			cdn: false,
			headers: {},
		});

		const knex = archive.getKnex();
		const resourceRow = await knex('resource_items as ri')
			.join('url_refs as ur', 'ur.id', 'ri.url_id')
			.select('ri.id as id')
			.where('ur.url', 'https://example.com/widely-used.js')
			.first();
		const resourceId: number = resourceRow.id;

		for (let i = 0; i < REFERRER_COUNT; i++) {
			const [urlRef] = await knex('url_refs')
				.insert({ url: `https://example.com/page-${i}` })
				.returning('id');
			const [pageRow] = await knex('content_items')
				.insert({
					url_id: (urlRef as { id: number }).id,
					is_external: 0,
					is_target: 1,
					scraped: 1,
					status: 200,
				})
				.returning('id');
			await knex('resource_ref_edges').insert({
				resource_id: resourceId,
				page_id: (pageRow as { id: number }).id,
				count: 1,
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

	it('keeps referrer_count exact beyond the note sample cap', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeResourceGroupRows(trx));
		const group = rows.find(
			(r) => r.canonical_url === 'https://example.com/widely-used.js',
		)!;
		expect(group.referrer_count).toBe(REFERRER_COUNT);
	});

	it('caps the referrer_note sample at 200 lines even with 201 referrers', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => computeResourceGroupRows(trx));
		const group = rows.find(
			(r) => r.canonical_url === 'https://example.com/widely-used.js',
		)!;
		const sampledLines = group.referrer_note!.split('\n');
		expect(sampledLines).toHaveLength(200);
	});
});
