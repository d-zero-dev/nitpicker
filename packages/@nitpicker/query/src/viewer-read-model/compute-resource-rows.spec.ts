import type { ResourceInsertRows } from './types.js';
import type { Knex } from 'knex';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeResourceInsertRows } from './compute-resource-rows.js';

/**
 * Drains {@link computeResourceInsertRows}'s chunks into a single
 * `ResourceInsertRows`, for tests that only care about the full result.
 * @param trx - An open Knex transaction.
 * @param chunkSize - Forwarded to {@link computeResourceInsertRows}.
 * @returns All chunks' `resources`/`stats` rows, concatenated in read order.
 */
async function collectResourceInsertRows(
	trx: Knex,
	chunkSize?: number,
): Promise<ResourceInsertRows> {
	const resources: ResourceInsertRows['resources'] = [];
	const stats: ResourceInsertRows['stats'] = [];
	for await (const chunk of computeResourceInsertRows(trx, chunkSize)) {
		resources.push(...chunk.resources);
		stats.push(...chunk.stats);
	}
	return { resources, stats };
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

describe('computeResourceInsertRows', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_compute_resource_rows__');
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-resource-rows-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		// Internal, unreferenced — the canonical "unused" case.
		await archive.setResources({
			url: parseUrl('https://example.com/orphan.pdf')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/pdf',
			contentLength: 1000,
			compress: false,
			cdn: false,
			headers: {},
		});

		// Internal, referenced twice by the same page and once by another —
		// referrer_count must be 3, is_unused must be 0.
		await archive.setResources({
			url: parseUrl('https://example.com/shared.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css; charset=utf-8',
			contentLength: 500,
			compress: false,
			cdn: false,
			headers: {},
		});
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
			meta: {
				lang: null,
				title: 'Page A',
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
			},
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
			meta: {
				lang: null,
				title: 'Page B',
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/page-a',
			src: 'https://example.com/shared.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/page-b',
			src: 'https://example.com/shared.css',
		});

		// External, unreferenced — must NOT be flagged unused (external
		// resources are excluded from "unused" regardless of referrer count).
		await archive.setResources({
			url: parseUrl('https://cdn.example.net/external.js')!,
			isExternal: true,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 200,
			compress: false,
			cdn: false,
			headers: {},
		});

		// Errored request — status is null, must fall back to the sentinel.
		await archive.setResources({
			url: parseUrl('https://example.com/timed-out.gif')!,
			isExternal: false,
			isError: true,
			status: null,
			statusText: null,
			contentType: null,
			contentLength: null,
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

	it('computes referrer_count from resources-referrers, deduplicated by page', async () => {
		const knex = archive.getKnex();
		const { resources, stats } = await knex.transaction((trx) =>
			collectResourceInsertRows(trx),
		);
		const shared = resources.find(
			(row) => row.url_sort_key === 'https://example.com/shared.css',
		);
		const sharedStats = stats.find((row) => row.resource_id === shared!.resource_id);
		expect(sharedStats!.referrer_count).toBe(2);
	});

	it('flags an internal, unreferenced resource as unused', async () => {
		const knex = archive.getKnex();
		const { resources } = await knex.transaction((trx) => collectResourceInsertRows(trx));
		const orphan = resources.find(
			(row) => row.url_sort_key === 'https://example.com/orphan.pdf',
		);
		expect(orphan).toMatchObject({ is_unused: 1, is_external: 0 });
	});

	it('never flags an external resource as unused, even with zero referrers', async () => {
		const knex = archive.getKnex();
		const { resources } = await knex.transaction((trx) => collectResourceInsertRows(trx));
		const external = resources.find(
			(row) => row.url_sort_key === 'https://cdn.example.net/external.js',
		);
		expect(external).toMatchObject({ is_unused: 0, is_external: 1 });
	});

	it('does not flag a referenced resource as unused', async () => {
		const knex = archive.getKnex();
		const { resources } = await knex.transaction((trx) => collectResourceInsertRows(trx));
		const shared = resources.find(
			(row) => row.url_sort_key === 'https://example.com/shared.css',
		);
		expect(shared).toMatchObject({ is_unused: 0 });
	});

	it('substitutes NULL_STATUS_SENTINEL for a null status and negates it for status_desc_key', async () => {
		const knex = archive.getKnex();
		const { resources } = await knex.transaction((trx) => collectResourceInsertRows(trx));
		const timedOut = resources.find(
			(row) => row.url_sort_key === 'https://example.com/timed-out.gif',
		)!;
		expect(timedOut.status).toBeNull();
		expect(timedOut.status_sort_key).toBe(timedOut.status_desc_key * -1);
		expect(timedOut.status_sort_key).toBeLessThan(100);
	});

	it('produces one viewer_resources row and one viewer_resource_stats row per resource', async () => {
		const knex = archive.getKnex();
		const { resources, stats } = await knex.transaction((trx) =>
			collectResourceInsertRows(trx),
		);
		expect(resources).toHaveLength(4);
		expect(stats).toHaveLength(4);
	});

	it('reads across multiple chunkSize-bounded chunks without losing or duplicating rows', async () => {
		const knex = archive.getKnex();
		const baseline = await knex.transaction((trx) => collectResourceInsertRows(trx));
		// chunkSize=1 forces every one of the 4 fixture resources into its own
		// chunk — the strongest exercise of the keyset cursor short of an
		// empty chunkSize.
		const chunked = await knex.transaction((trx) => collectResourceInsertRows(trx, 1));
		const byResourceId = (rows: { resource_id: number }[]) =>
			rows.toSorted((a, b) => a.resource_id - b.resource_id);
		expect(byResourceId(chunked.resources)).toEqual(byResourceId(baseline.resources));
		expect(byResourceId(chunked.stats)).toEqual(byResourceId(baseline.stats));
	});

	it('throws on a non-positive chunkSize instead of silently yielding nothing or looping forever', async () => {
		const knex = archive.getKnex();
		await expect(
			knex.transaction((trx) => collectResourceInsertRows(trx, 0)),
		).rejects.toThrow(RangeError);
		await expect(
			knex.transaction((trx) => collectResourceInsertRows(trx, -1)),
		).rejects.toThrow(RangeError);
	});
});
