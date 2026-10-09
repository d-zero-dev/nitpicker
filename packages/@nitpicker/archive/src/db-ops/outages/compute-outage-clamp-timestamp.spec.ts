import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { computeOutageClampTimestamp } from './compute-outage-clamp-timestamp.js';

/**
 * Insert a minimal `content_items` row with an explicit `last_crawled_at`, satisfying the `url_refs` FK.
 * @param db
 * @param url
 * @param lastCrawledAt
 */
async function insertPageRow(
	db: Knex,
	url: string,
	lastCrawledAt: number | null,
): Promise<void> {
	const [{ id: urlId }] = (await db('url_refs').insert({ url }).returning('id')) as {
		id: number;
	}[];
	await db('content_items').insert({
		url_id: urlId,
		is_external: 0,
		scraped: 1,
		is_target: 1,
		last_crawled_at: lastCrawledAt,
	});
}

/**
 *
 * @param db
 * @param createdAt
 */
async function insertCrawlErrorRow(db: Knex, createdAt: number): Promise<void> {
	await db('crawl_errors').insert({
		url: 'https://a.example/',
		isExternal: 0,
		message: 'getaddrinfo ENOTFOUND a.example',
		createdAt,
	});
}

describe('computeOutageClampTimestamp', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
		await createAdjunctTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('returns 0 on a brand-new archive with no activity', async () => {
		expect(await computeOutageClampTimestamp(db)).toBe(0);
	});

	it('returns the latest crawl_errors.createdAt when it is the larger of the two', async () => {
		await insertCrawlErrorRow(db, 5000);
		await insertPageRow(db, 'https://a.example/ok', 1000);
		expect(await computeOutageClampTimestamp(db)).toBe(5000);
	});

	it('returns the latest content_items.last_crawled_at when it is the larger of the two', async () => {
		await insertCrawlErrorRow(db, 1000);
		await insertPageRow(db, 'https://a.example/ok', 8000);
		expect(await computeOutageClampTimestamp(db)).toBe(8000);
	});

	it('ignores a null last_crawled_at row when computing the max', async () => {
		await insertPageRow(db, 'https://a.example/never-crawled', null);
		await insertCrawlErrorRow(db, 3000);
		expect(await computeOutageClampTimestamp(db)).toBe(3000);
	});

	it('takes the max across multiple rows in each table', async () => {
		await insertCrawlErrorRow(db, 1000);
		await insertCrawlErrorRow(db, 9000);
		await insertPageRow(db, 'https://a.example/a', 2000);
		await insertPageRow(db, 'https://a.example/b', 4000);
		expect(await computeOutageClampTimestamp(db)).toBe(9000);
	});
});
