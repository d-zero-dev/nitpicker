import path from 'node:path';

import { Archive, populateMigrationTables } from '@nitpicker/crawler';
import { afterEach, describe, expect, it } from 'vitest';

import { excludeSkippedPages } from './exclude-skipped-pages.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_exclude_skipped__');

/**
 * Minimal config so `Archive.create` doesn't reject. The values are irrelevant
 * — we never crawl, we just need a writable `pages` table to seed and then
 * populate into the 0.13 `content_items` entity table.
 * @returns Skeleton `Config` shape.
 */
function baseConfig() {
	return {
		baseUrl: 'https://example.com',
		name: 'test',
		version: '0.13.0',
		recursive: true,
		interval: 0,
		image: false,
		fetchExternal: true,
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
}

/**
 * Runs `excludeSkippedPages` against the 0.13 `content_items` table (using
 * the `is_skipped` snake_case column) after seeding legacy `pages` rows and
 * populating the migration tables.
 * @param knex - Archive Knex instance.
 * @returns The URLs surviving the exclusion predicate, in stable order.
 */
async function urlsSurvivingExclusion(
	knex: ReturnType<InstanceType<typeof Archive>['getKnex']>,
): Promise<string[]> {
	const rows = (await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.where((qb) => excludeSkippedPages(qb, 'ci.is_skipped'))
		.select('ur.url as url')
		.orderBy('ur.url')) as { url: string }[];
	return rows.map((r) => r.url);
}

describe('excludeSkippedPages', () => {
	let archive: InstanceType<typeof Archive> | undefined;

	afterEach(async () => {
		if (archive) {
			await archive.releaseHandle();
			archive = undefined;
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('keeps `isSkipped = 0` rows and drops `isSkipped = 1` rows', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'keeps-zero.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		const knex = archive.getKnex();

		await knex('pages').insert([
			{
				url: 'https://example.com/scraped',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: '{}',
				isSkipped: 0,
			},
			{
				url: 'https://example.com/skipped',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: null,
				statusText: null,
				contentType: null,
				contentLength: null,
				responseHeaders: '{}',
				isSkipped: 1,
			},
		]);
		await populateMigrationTables(archive);

		expect(await urlsSurvivingExclusion(knex)).toEqual(['https://example.com/scraped']);
	});

	it('keeps `isSkipped IS NULL` rows for backwards compatibility with pre-flag archives', async () => {
		// The carve-out's `orWhereNull('is_skipped')` exists so an archive
		// created before the column was added (where every existing row
		// carries NULL) still shows up in Summary aggregations. Without
		// this branch, opening a legacy archive in the viewer would
		// silently report 0 pages.
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'keeps-null.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		const knex = archive.getKnex();

		await knex('pages').insert([
			{
				url: 'https://example.com/legacy',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: '{}',
				isSkipped: null,
			},
			{
				url: 'https://example.com/skipped',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: null,
				statusText: null,
				contentType: null,
				contentLength: null,
				responseHeaders: '{}',
				isSkipped: 1,
			},
		]);
		await populateMigrationTables(archive);
		// Simulate a pre-flag archive by nulling the newly-populated
		// `content_items.is_skipped` value for the legacy row.
		await knex('content_items as ci')
			.update({ is_skipped: null })
			.whereIn(
				'ci.url_id',
				knex('url_refs').select('id').where('url', 'https://example.com/legacy'),
			);

		expect(await urlsSurvivingExclusion(knex)).toEqual(['https://example.com/legacy']);
	});

	it('returns the empty set when every row is `isSkipped = 1`', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'all-skipped.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		const knex = archive.getKnex();

		await knex('pages').insert([
			{
				url: 'https://example.com/skipped-a',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: null,
				statusText: null,
				contentType: null,
				contentLength: null,
				responseHeaders: '{}',
				isSkipped: 1,
			},
			{
				url: 'https://example.com/skipped-b',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: null,
				statusText: null,
				contentType: null,
				contentLength: null,
				responseHeaders: '{}',
				isSkipped: 1,
			},
		]);
		await populateMigrationTables(archive);

		expect(await urlsSurvivingExclusion(knex)).toEqual([]);
	});
});
