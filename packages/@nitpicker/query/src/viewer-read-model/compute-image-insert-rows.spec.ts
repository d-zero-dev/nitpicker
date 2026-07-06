import type { ImageInsertRow } from './types.js';
import type { Knex } from 'knex';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildPageUrlRankMap } from './build-page-url-rank-map.js';
import { computeImageInsertRows } from './compute-image-insert-rows.js';

/**
 * Drains {@link computeImageInsertRows}'s chunks into a single array, for
 * tests that only care about the full result.
 * @param trx - An open Knex transaction.
 * @param pageUrlRankById - Forwarded to {@link computeImageInsertRows}.
 * @param chunkSize - Forwarded to {@link computeImageInsertRows}.
 * @returns All chunks' rows, concatenated in read order.
 */
async function collectImageInsertRows(
	trx: Knex,
	pageUrlRankById: ReadonlyMap<number, number>,
	chunkSize?: number,
): Promise<ImageInsertRow[]> {
	const rows: ImageInsertRow[] = [];
	for await (const chunk of computeImageInsertRows(trx, pageUrlRankById, chunkSize)) {
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

const NOOP_META = {
	lang: null,
	title: 'Page',
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

describe('computeImageInsertRows', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_image_insert_rows__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'compute-image-rows-test.nitpicker');

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
			responseHeaders: {},
			html: '',
			meta: NOOP_META,
			anchorList: [],
			imageList: [
				{
					src: 'https://example.com/a.png',
					currentSrc: 'https://example.com/a.png',
					alt: 'A',
					width: 100,
					height: 100,
					naturalWidth: 100,
					naturalHeight: 100,
					isLazy: true,
					viewportWidth: 1200,
					sourceCode: '<img src="a.png" alt="A">',
				},
				{
					src: 'https://example.com/b.png',
					currentSrc: 'https://example.com/b.png',
					alt: '',
					width: 0,
					height: 0,
					naturalWidth: 50,
					naturalHeight: 50,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="b.png">',
				},
			],
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

	it('flags missing_alt for a null or empty alt attribute', async () => {
		const knex = archive.getKnex();
		const rankById = buildPageUrlRankMap(await knex('pages').select('id', 'url'));
		const rows = await knex.transaction((trx) => collectImageInsertRows(trx, rankById));
		const a = rows.find((r) => r.width === 100)!;
		const b = rows.find((r) => r.width === 0)!;
		expect(a.missing_alt).toBe(0);
		expect(b.missing_alt).toBe(1);
	});

	it('flags missing_dimensions when width or height is 0', async () => {
		const knex = archive.getKnex();
		const rankById = buildPageUrlRankMap(await knex('pages').select('id', 'url'));
		const rows = await knex.transaction((trx) => collectImageInsertRows(trx, rankById));
		const a = rows.find((r) => r.width === 100)!;
		const b = rows.find((r) => r.width === 0)!;
		expect(a.missing_dimensions).toBe(0);
		expect(b.missing_dimensions).toBe(1);
	});

	it('coerces isLazy to 0/1, treating a falsy source value as 0', async () => {
		const knex = archive.getKnex();
		const rankById = buildPageUrlRankMap(await knex('pages').select('id', 'url'));
		const rows = await knex.transaction((trx) => collectImageInsertRows(trx, rankById));
		const a = rows.find((r) => r.width === 100)!;
		const b = rows.find((r) => r.width === 0)!;
		expect(a.is_lazy).toBe(1);
		expect(b.is_lazy).toBe(0);
	});

	it('copies natural_width/natural_height verbatim', async () => {
		const knex = archive.getKnex();
		const rankById = buildPageUrlRankMap(await knex('pages').select('id', 'url'));
		const rows = await knex.transaction((trx) => collectImageInsertRows(trx, rankById));
		const b = rows.find((r) => r.width === 0)!;
		expect(b.natural_width).toBe(50);
		expect(b.natural_height).toBe(50);
	});

	it('applies the resolved page_url_rank from the supplied map', async () => {
		const knex = archive.getKnex();
		const pageRows: { id: number; url: string }[] = await knex('pages').select(
			'id',
			'url',
		);
		const rankById = buildPageUrlRankMap(pageRows);
		const rows = await knex.transaction((trx) => collectImageInsertRows(trx, rankById));
		const expectedRank = rankById.get(pageRows[0]!.id);
		expect(rows.every((r) => r.page_url_rank === expectedRank)).toBe(true);
	});

	it('falls back to a last-place sentinel rank for a page_id absent from the map — defensive only', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction((trx) => collectImageInsertRows(trx, new Map()));
		expect(rows.every((r) => r.page_url_rank === Number.MAX_SAFE_INTEGER)).toBe(true);
	});

	it('produces one row per images row', async () => {
		const knex = archive.getKnex();
		const rankById = buildPageUrlRankMap(await knex('pages').select('id', 'url'));
		const rows = await knex.transaction((trx) => collectImageInsertRows(trx, rankById));
		expect(rows).toHaveLength(2);
	});

	it('reads across multiple chunkSize-bounded chunks without losing or duplicating rows', async () => {
		const knex = archive.getKnex();
		const rankById = buildPageUrlRankMap(await knex('pages').select('id', 'url'));
		const baseline = await knex.transaction((trx) =>
			collectImageInsertRows(trx, rankById),
		);
		const chunked = await knex.transaction((trx) =>
			collectImageInsertRows(trx, rankById, 1),
		);
		const byImageId = (rows: ImageInsertRow[]) =>
			rows.toSorted((a, b) => a.image_id - b.image_id);
		expect(byImageId(chunked)).toEqual(byImageId(baseline));
	});

	it('throws on a non-positive chunkSize instead of silently yielding nothing or looping forever', async () => {
		const knex = archive.getKnex();
		await expect(
			knex.transaction((trx) => collectImageInsertRows(trx, new Map(), 0)),
		).rejects.toThrow(RangeError);
		await expect(
			knex.transaction((trx) => collectImageInsertRows(trx, new Map(), -1)),
		).rejects.toThrow(RangeError);
	});
});
