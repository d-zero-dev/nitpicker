import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { getResourceUrlList } from './get-resource-url-list.js';

/**
 * Inserts one `url_refs` + `resource_items` pair.
 * @param db - Knex connected to the in-memory test DB.
 * @param url - URL string to register.
 */
async function seedResource(db: Knex, url: string): Promise<void> {
	const [urlRef] = await db('url_refs').insert({ url }).returning('id');
	await db('resource_items').insert({ url_id: urlRef.id, is_external: 0 });
}

describe('getResourceUrlList', () => {
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

	it('returns an empty array for an empty archive', async () => {
		expect(await getResourceUrlList(db)).toEqual([]);
	});

	it('returns every resource URL resolved through url_refs', async () => {
		await seedResource(db, 'https://example.com/style.css');
		await seedResource(db, 'https://example.com/app.js');
		const urls = await getResourceUrlList(db);
		expect(urls.toSorted()).toEqual([
			'https://example.com/app.js',
			'https://example.com/style.css',
		]);
	});

	it('does not include page URLs from content_items', async () => {
		await seedResource(db, 'https://example.com/style.css');
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		await db('content_items').insert({
			url_id: urlRef.id,
			scraped: 1,
			is_target: 1,
			is_external: 0,
		});
		expect(await getResourceUrlList(db)).toEqual(['https://example.com/style.css']);
	});

	it('reads across a small fixture within a single keyset chunk without losing or duplicating rows', async () => {
		const urls: string[] = [];
		for (let i = 0; i < 5; i++) {
			const url = `https://example.com/resource-${i}.js`;
			urls.push(url);
			await seedResource(db, url);
		}
		const result = await getResourceUrlList(db);
		expect(result.toSorted()).toEqual(urls.toSorted());
	});

	it('reads across multiple keyset chunks (> READ_CHUNK_SIZE rows) without losing or duplicating rows (issue #294)', async () => {
		// READ_CHUNK_SIZE is 2000 — insert one row past two full chunk
		// boundaries so the `lastId` carry-over across `for(;;)` iterations is
		// actually exercised, not just the single-chunk path. Explicit ids +
		// `batchInsert` (same pattern as check-url-round-trip.spec.ts) avoid
		// both per-row round trips and SQLite's ~999 bound-parameter limit
		// that a single 4000+-row `.insert([...])` call would hit.
		const rowCount = 4001;
		const urlRefRows = Array.from({ length: rowCount }, (_, i) => ({
			id: i + 1,
			url: `https://example.com/resource-${i}.js`,
		}));
		const resourceRows = urlRefRows.map((row) => ({
			id: row.id,
			url_id: row.id,
			is_external: 0,
		}));
		await db.batchInsert('url_refs', urlRefRows, 500);
		await db.batchInsert('resource_items', resourceRows, 500);

		const result = await getResourceUrlList(db);
		expect(result).toHaveLength(rowCount);
		expect(new Set(result).size).toBe(rowCount);
		expect(result.toSorted()).toEqual(urlRefRows.map((row) => row.url).toSorted());
	}, 20_000);

	it('reports keyset scan progress up to the max resource_items id (issue #294)', async () => {
		await seedResource(db, 'https://example.com/a.js');
		await seedResource(db, 'https://example.com/b.js');

		const calls: [number, number][] = [];
		await getResourceUrlList(db, (scannedUpToId, maxId) => {
			calls.push([scannedUpToId, maxId]);
		});

		expect(calls.length).toBeGreaterThan(0);
		const maxId = calls[0]![1];
		expect(maxId).toBeGreaterThan(0);
		for (const [scannedUpToId, total] of calls) {
			expect(total).toBe(maxId);
			expect(scannedUpToId).toBeLessThanOrEqual(maxId);
		}
		for (let i = 1; i < calls.length; i++) {
			expect(calls[i]![0]).toBeGreaterThanOrEqual(calls[i - 1]![0]);
		}
		expect(calls.at(-1)![0]).toBe(maxId);
	});

	it('reports progress once at maxId (0) for an empty archive without calling onProgress with undefined', async () => {
		const calls: [number, number][] = [];
		expect(await getResourceUrlList(db, (a, b) => calls.push([a, b]))).toEqual([]);
		expect(calls).toEqual([[0, 0]]);
	});
});
