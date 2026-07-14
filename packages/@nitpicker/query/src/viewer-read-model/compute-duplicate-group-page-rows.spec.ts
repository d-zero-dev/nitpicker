import type { DuplicateGroupPageInsertRow } from './compute-duplicate-group-page-rows.js';
import type { Knex } from 'knex';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeDuplicateGroupPageRows } from './compute-duplicate-group-page-rows.js';
import { computeDuplicateGroupRows } from './compute-duplicate-group-rows.js';

/**
 * Drains {@link computeDuplicateGroupPageRows}'s chunks into a single array,
 * for tests that only care about the full result.
 * @param trx - An open Knex transaction.
 * @param groupIdByValue - Forwarded to `computeDuplicateGroupPageRows`.
 * @param chunkSize - Forwarded to `computeDuplicateGroupPageRows`.
 * @returns Every chunk's rows, concatenated in read order.
 */
async function collectDuplicateGroupPageRows(
	trx: Knex,
	groupIdByValue: Parameters<typeof computeDuplicateGroupPageRows>[1],
	chunkSize?: number,
): Promise<DuplicateGroupPageInsertRow[]> {
	const rows: DuplicateGroupPageInsertRow[] = [];
	for await (const chunk of computeDuplicateGroupPageRows(
		trx,
		groupIdByValue,
		chunkSize,
	)) {
		rows.push(...chunk);
	}
	return rows;
}

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

describe('computeDuplicateGroupPageRows', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_duplicate_group_pages__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-duplicate-group-pages-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		const pages = [
			{ url: 'https://example.com/t1', title: 'T-Dup', description: null },
			{ url: 'https://example.com/t2', title: 'T-Dup', description: null },
			{ url: 'https://example.com/d1', title: null, description: 'D-Dup' },
			{ url: 'https://example.com/d2', title: null, description: 'D-Dup' },
			// Duplicates on BOTH fields — must attach to both groups (2 rows).
			{ url: 'https://example.com/both', title: 'T-Dup', description: 'D-Dup' },
			// Singleton — must never appear in any group's member rows.
			{
				url: 'https://example.com/lonely',
				title: 'Lonely Title',
				description: 'Lonely Description',
			},
		];

		for (const p of pages) {
			await archive.setPage({
				url: parseUrl(p.url)!,
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
					title: p.title,
					description: p.description,
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
		}
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('attaches every member page to its title/description group(s), a both-duplicating page to both', async () => {
		const knex = archive.getKnex();
		const rows = await knex.transaction(async (trx) => {
			const { groupIdByValue } = await computeDuplicateGroupRows(trx);
			return collectDuplicateGroupPageRows(trx, groupIdByValue);
		});

		const byUrl = new Map<string, DuplicateGroupPageInsertRow[]>();
		for (const row of rows) {
			const list = byUrl.get(row.url_sort_key) ?? [];
			list.push(row);
			byUrl.set(row.url_sort_key, list);
		}

		expect(byUrl.get('https://example.com/t1')).toHaveLength(1);
		expect(byUrl.get('https://example.com/t2')).toHaveLength(1);
		expect(byUrl.get('https://example.com/d1')).toHaveLength(1);
		expect(byUrl.get('https://example.com/d2')).toHaveLength(1);

		// Duplicates on both fields — exactly 2 rows, one per group, distinct
		// group_ids.
		const bothRows = byUrl.get('https://example.com/both');
		expect(bothRows).toHaveLength(2);
		expect(new Set(bothRows!.map((r) => r.group_id)).size).toBe(2);

		// The singleton page never appears at all.
		expect(byUrl.has('https://example.com/lonely')).toBe(false);
	});

	it('groups the title-duplicate members under one group_id and the description-duplicate members under another', async () => {
		const knex = archive.getKnex();
		const { rows, groupIdByValue } = await knex.transaction(async (trx) => {
			const { groupIdByValue: index } = await computeDuplicateGroupRows(trx);
			const collected = await collectDuplicateGroupPageRows(trx, index);
			return { rows: collected, groupIdByValue: index };
		});

		const titleGroupId = groupIdByValue.get('title')!.get('T-Dup')!;
		const descriptionGroupId = groupIdByValue.get('description')!.get('D-Dup')!;

		const titleMembers = rows
			.filter((r) => r.group_id === titleGroupId)
			.map((r) => r.url_sort_key)
			.toSorted();
		expect(titleMembers).toEqual(
			[
				'https://example.com/t1',
				'https://example.com/t2',
				'https://example.com/both',
			].toSorted(),
		);

		const descriptionMembers = rows
			.filter((r) => r.group_id === descriptionGroupId)
			.map((r) => r.url_sort_key)
			.toSorted();
		expect(descriptionMembers).toEqual(
			[
				'https://example.com/d1',
				'https://example.com/d2',
				'https://example.com/both',
			].toSorted(),
		);
	});

	it('reads across multiple chunkSize-bounded chunks without losing or duplicating rows', async () => {
		const knex = archive.getKnex();
		const baseline = await knex.transaction(async (trx) => {
			const { groupIdByValue } = await computeDuplicateGroupRows(trx);
			return collectDuplicateGroupPageRows(trx, groupIdByValue);
		});
		// chunkSize=1 forces every one of the 6 fixture pages into its own
		// `pages` scan chunk — the strongest exercise of the keyset cursor
		// short of an empty chunkSize.
		const chunked = await knex.transaction(async (trx) => {
			const { groupIdByValue } = await computeDuplicateGroupRows(trx);
			return collectDuplicateGroupPageRows(trx, groupIdByValue, 1);
		});

		const sortKey = (row: DuplicateGroupPageInsertRow) =>
			`${row.group_id}:${row.page_id}`;
		expect(chunked.toSorted((a, b) => (sortKey(a) > sortKey(b) ? 1 : -1))).toEqual(
			baseline.toSorted((a, b) => (sortKey(a) > sortKey(b) ? 1 : -1)),
		);
	});

	it('short-circuits to zero rows without scanning pages when groupIdByValue has no duplicate values', async () => {
		const knex = archive.getKnex();
		const emptyIndex = new Map([
			['title', new Map<string, number>()],
			['description', new Map<string, number>()],
		]) as Parameters<typeof computeDuplicateGroupPageRows>[1];
		const rows = await knex.transaction((trx) =>
			collectDuplicateGroupPageRows(trx, emptyIndex),
		);
		expect(rows).toEqual([]);
	});

	it('throws on a non-positive chunkSize instead of silently yielding nothing or looping forever', async () => {
		const knex = archive.getKnex();
		await expect(
			knex.transaction(async (trx) => {
				const { groupIdByValue } = await computeDuplicateGroupRows(trx);
				return collectDuplicateGroupPageRows(trx, groupIdByValue, 0);
			}),
		).rejects.toThrow(RangeError);
		await expect(
			knex.transaction(async (trx) => {
				const { groupIdByValue } = await computeDuplicateGroupRows(trx);
				return collectDuplicateGroupPageRows(trx, groupIdByValue, -1);
			}),
		).rejects.toThrow(RangeError);
	});
});
