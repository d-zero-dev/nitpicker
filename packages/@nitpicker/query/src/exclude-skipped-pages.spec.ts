import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
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
 * the `is_skipped` snake_case column) after seeding `content_items` rows
 * directly.
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

/**
 * Directly inserts a `content_items` row (via `url_refs`) for this spec's
 * fixtures.
 * @param knex - Archive Knex instance.
 * @param row - The page fields to insert.
 * @param row.url
 * @param row.isSkipped
 */
async function insertPage(
	knex: ReturnType<InstanceType<typeof Archive>['getKnex']>,
	row: { url: string; isSkipped: number | null },
): Promise<void> {
	const [urlRef] = await knex('url_refs').insert({ url: row.url }).returning('id');
	await knex('content_items').insert({
		url_id: urlRef.id,
		scraped: 1,
		is_target: 1,
		is_external: 0,
		is_skipped: row.isSkipped,
	});
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

		await insertPage(knex, { url: 'https://example.com/scraped', isSkipped: 0 });
		await insertPage(knex, { url: 'https://example.com/skipped', isSkipped: 1 });

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

		await insertPage(knex, { url: 'https://example.com/legacy', isSkipped: null });
		await insertPage(knex, { url: 'https://example.com/skipped', isSkipped: 1 });

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

		await insertPage(knex, { url: 'https://example.com/skipped-a', isSkipped: 1 });
		await insertPage(knex, { url: 'https://example.com/skipped-b', isSkipped: 1 });

		expect(await urlsSurvivingExclusion(knex)).toEqual([]);
	});
});
