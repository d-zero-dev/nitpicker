import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyEqualityOrInFilter } from './apply-equality-or-in-filter.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

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

describe('applyEqualityOrInFilter', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_equality_or_in_filter__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'apply-equality-or-in-filter-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		for (const [path_, status] of [
			['/ok', 200],
			['/not-found', 404],
			['/error', 500],
		] as const) {
			await archive.setPage({
				url: parseUrl(`https://example.com${path_}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status,
				statusText: 'status',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('applies an equality predicate for a scalar value', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyEqualityOrInFilter(qb, 'status_sort_key', 404);
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/not-found']);
	});

	it('applies an OR predicate across all values for an array', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyEqualityOrInFilter(qb, 'status_sort_key', [200, 500]);
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url).toSorted()).toEqual([
			'https://example.com/error',
			'https://example.com/ok',
		]);
	});

	it('treats undefined as "no filter"', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyEqualityOrInFilter(qb, 'status_sort_key');
		const rows = await qb.select('url');
		expect(rows).toHaveLength(3);
	});

	it('treats an empty array as "no filter", not "match nothing"', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyEqualityOrInFilter(qb, 'status_sort_key', []);
		const rows = await qb.select('url');
		expect(rows).toHaveLength(3);
	});

	it('deduplicates repeated values in the array', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyEqualityOrInFilter(qb, 'status_sort_key', [404, 404, 404]);
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/not-found']);
	});

	it('still matches correctly when the array exceeds the SQLite IN-clause chunk size (500) — regression test for the orWhereIn chunking branch', async () => {
		// 600 distinct non-matching sentinel values plus the one real status
		// (404) — large enough to force the `values.length > SQLITE_IN_CHUNK`
		// branch (chunked into two `orWhereIn` calls) while still asserting a
		// concrete, non-empty result rather than just "it didn't throw".
		const values = Array.from({ length: 600 }, (_, i) => 10_000 + i);
		values.push(404);
		const knex = archive.getKnex();
		const qb = knex('viewer_pages');
		applyEqualityOrInFilter(qb, 'status_sort_key', values);
		const rows = await qb.select('url');
		expect(rows.map((r) => r.url)).toEqual(['https://example.com/not-found']);
	});
});
