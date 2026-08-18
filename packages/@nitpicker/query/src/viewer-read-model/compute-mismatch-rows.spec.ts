import type { MismatchInsertRow } from './compute-mismatch-rows.js';
import type { Knex } from 'knex';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeBeholderMeta } from '../test-helpers/make-beholder-meta.js';

import { computeMismatchInsertRows } from './compute-mismatch-rows.js';

/**
 * Drains {@link computeMismatchInsertRows}'s chunks into a single array, for
 * tests that only care about the full result.
 * @param trx - An open Knex transaction.
 * @param chunkSize - Forwarded to `computeMismatchInsertRows`.
 * @returns Every chunk's rows, concatenated in read order.
 */
async function collectMismatchInsertRows(
	trx: Knex,
	chunkSize?: number,
): Promise<MismatchInsertRow[]> {
	const rows: MismatchInsertRow[] = [];
	for await (const chunk of computeMismatchInsertRows(trx, chunkSize)) {
		rows.push(...chunk);
	}
	return rows;
}

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_compute_mismatch_rows__');

describe('computeMismatchInsertRows', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-mismatch-rows-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
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
		});

		// canonical mismatch only.
		await archive.setPage({
			url: parseUrl('https://example.com/canonical-only')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: makeBeholderMeta({
				title: 'Same',
				description: 'Same description',
				link: { canonical: 'https://example.com/canonical-target' },
				og: { title: 'Same', description: 'Same description' },
			}),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// og:title AND og:description mismatch on the same page.
		await archive.setPage({
			url: parseUrl('https://example.com/og-mismatch')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: makeBeholderMeta({
				title: 'Real Title',
				description: 'Real Description',
				link: { canonical: 'https://example.com/og-mismatch' },
				og: { title: 'Different OG Title', description: 'Different OG Description' },
			}),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// No mismatches at all — must never appear in any type's output.
		await archive.setPage({
			url: parseUrl('https://example.com/clean')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: makeBeholderMeta({
				title: 'Clean',
				description: 'Clean description',
				link: { canonical: 'https://example.com/clean' },
				og: { title: 'Clean', description: 'Clean description' },
			}),
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

	it('emits a canonical mismatch row with actual=url and expected=canonical', async () => {
		const rows = await archive
			.getKnex()
			.transaction((trx) => collectMismatchInsertRows(trx));
		const canonicalRows = rows.filter((r) => r.type === 'canonical');
		expect(canonicalRows).toHaveLength(1);
		expect(canonicalRows[0]).toMatchObject({
			url_sort_key: 'https://example.com/canonical-only',
			actual: 'https://example.com/canonical-only',
			expected: 'https://example.com/canonical-target',
		});
	});

	it('emits an og:title mismatch row with actual=og_title and expected=title', async () => {
		const rows = await archive
			.getKnex()
			.transaction((trx) => collectMismatchInsertRows(trx));
		const ogTitleRows = rows.filter((r) => r.type === 'og:title');
		expect(ogTitleRows).toHaveLength(1);
		expect(ogTitleRows[0]).toMatchObject({
			url_sort_key: 'https://example.com/og-mismatch',
			actual: 'Different OG Title',
			expected: 'Real Title',
		});
	});

	it('emits an og:description mismatch row with actual=og_description and expected=description', async () => {
		const rows = await archive
			.getKnex()
			.transaction((trx) => collectMismatchInsertRows(trx));
		const ogDescriptionRows = rows.filter((r) => r.type === 'og:description');
		expect(ogDescriptionRows).toHaveLength(1);
		expect(ogDescriptionRows[0]).toMatchObject({
			url_sort_key: 'https://example.com/og-mismatch',
			actual: 'Different OG Description',
			expected: 'Real Description',
		});
	});

	it('never emits a row for a page with matching metadata on every comparison', async () => {
		const rows = await archive
			.getKnex()
			.transaction((trx) => collectMismatchInsertRows(trx));
		expect(rows.some((r) => r.url_sort_key === 'https://example.com/clean')).toBe(false);
	});

	it('reads across multiple chunkSize-bounded chunks (per type) without losing or duplicating rows', async () => {
		const knex = archive.getKnex();
		const baseline = await knex.transaction((trx) => collectMismatchInsertRows(trx));
		const chunked = await knex.transaction((trx) => collectMismatchInsertRows(trx, 1));

		const sortKey = (row: MismatchInsertRow) => `${row.type}:${row.page_id}`;
		expect(chunked.toSorted((a, b) => (sortKey(a) > sortKey(b) ? 1 : -1))).toEqual(
			baseline.toSorted((a, b) => (sortKey(a) > sortKey(b) ? 1 : -1)),
		);
	});

	it('throws on a non-positive chunkSize instead of silently yielding nothing or looping forever', async () => {
		const knex = archive.getKnex();
		await expect(
			knex.transaction((trx) => collectMismatchInsertRows(trx, 0)),
		).rejects.toThrow(RangeError);
		await expect(
			knex.transaction((trx) => collectMismatchInsertRows(trx, -1)),
		).rejects.toThrow(RangeError);
	});

	it('reports one progress update per completed scan pass, 6 in total (issue #294)', async () => {
		const knex = archive.getKnex();
		const calls: [number, number][] = [];
		await knex.transaction(async (trx) => {
			for await (const chunk of computeMismatchInsertRows(
				trx,
				undefined,
				(completedScans, totalScans) => {
					calls.push([completedScans, totalScans]);
				},
			)) {
				expect(chunk.length).toBeGreaterThan(0);
			}
		});

		expect(calls).toEqual([
			[1, 6],
			[2, 6],
			[3, 6],
			[4, 6],
			[5, 6],
			[6, 6],
		]);
	});

	it('gives every mismatch row for the same page the same natural_url_rank, regardless of type', async () => {
		const rows = await archive
			.getKnex()
			.transaction((trx) => collectMismatchInsertRows(trx));
		// '/og-mismatch' fails both og:title and og:description — one row
		// per type, but both are the same page and must share one rank.
		const ogRows = rows.filter(
			(r) => r.url_sort_key === 'https://example.com/og-mismatch',
		);
		expect(ogRows).toHaveLength(2);
		expect(ogRows[0]!.natural_url_rank).toBe(ogRows[1]!.natural_url_rank);
	});
});

/**
 * Isolated into its own archive (rather than added to the main describe
 * block's fixture) so the numeric-segment URLs don't perturb the main
 * block's exact per-type row counts.
 */
describe('computeMismatchInsertRows — natural_url_rank natural order', () => {
	const naturalSortWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_mismatch_rows_natural_sort__',
	);
	let archive: InstanceType<typeof Archive>;
	const naturalSortArchiveFilePath = path.resolve(
		naturalSortWorkingDir,
		'compute-mismatch-rows-natural-sort-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(naturalSortWorkingDir, { recursive: true });
		archive = await Archive.create({
			filePath: naturalSortArchiveFilePath,
			cwd: naturalSortWorkingDir,
		});
		await archive.setConfig({
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
		});

		// Two canonical mismatches with numeric-segment URLs, seeded in an
		// order chosen so BINARY and natural collation disagree: BINARY
		// puts '/page10' before '/page2' ('1' < '2' byte-wise), natural
		// puts '/page2' before '/page10' (2 < 10 numerically).
		for (const pathname of ['/page10', '/page2']) {
			await archive.setPage({
				url: parseUrl(`https://example.com${pathname}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: makeBeholderMeta({
					title: 'Same',
					link: { canonical: 'https://example.com/canonical-target' },
				}),
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
		rmSync(naturalSortWorkingDir, { recursive: true, force: true });
	});

	it('ranks page2 below page10 in natural (numeric-aware) order, not BINARY order', async () => {
		const rows = await archive
			.getKnex()
			.transaction((trx) => collectMismatchInsertRows(trx));
		const page2 = rows.find((r) => r.url_sort_key === 'https://example.com/page2')!;
		const page10 = rows.find((r) => r.url_sort_key === 'https://example.com/page10')!;
		expect(page2.natural_url_rank).toBeLessThan(page10.natural_url_rank);
	});
});
