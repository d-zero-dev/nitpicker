import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { keysetPaginateById } from './keyset-paginate-by-id.js';

const CHUNK_SIZE = 2;

/**
 * Runs `keysetPaginateById` over `resource_items`/`url_refs`, mirroring
 * `getResourceUrlList`'s exact query shape — the simplest realistic
 * consumer of this helper — with a small chunk size so multi-chunk
 * behaviour is exercised without seeding thousands of rows.
 * @param db - Knex connected to the in-memory test DB.
 * @param onProgress - Forwarded to `keysetPaginateById`.
 * @returns Every resource URL, in `id` order.
 */
async function paginateResourceUrls(
	db: Knex,
	onProgress?: (scannedUpToId: number, maxId: number) => void,
): Promise<string[]> {
	return keysetPaginateById<{ id: number; url: string }, string>(
		db,
		'resource_items',
		(lastId) =>
			db('resource_items')
				.join('url_refs', 'url_refs.id', 'resource_items.url_id')
				.where('resource_items.id', '>', lastId)
				.orderBy('resource_items.id', 'asc')
				.limit(CHUNK_SIZE)
				.select('resource_items.id as id', 'url_refs.url as url'),
		(row) => row.url,
		onProgress,
	);
}

/**
 * Inserts one `url_refs` + `resource_items` pair.
 * @param db - Knex connected to the in-memory test DB.
 * @param url - URL string to register.
 */
async function seedResource(db: Knex, url: string): Promise<void> {
	const [urlRef] = await db('url_refs').insert({ url }).returning('id');
	await db('resource_items').insert({ url_id: urlRef.id, is_external: 0 });
}

describe('keysetPaginateById', () => {
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

	it('返す行が無ければ空配列を返す', async () => {
		expect(await paginateResourceUrls(db)).toEqual([]);
	});

	it('チャンクサイズより多い行数でも全件をid順に返す', async () => {
		await seedResource(db, 'https://example.com/a.js');
		await seedResource(db, 'https://example.com/b.js');
		await seedResource(db, 'https://example.com/c.js');
		await seedResource(db, 'https://example.com/d.js');
		await seedResource(db, 'https://example.com/e.js');

		const urls = await paginateResourceUrls(db);
		expect(urls).toEqual([
			'https://example.com/a.js',
			'https://example.com/b.js',
			'https://example.com/c.js',
			'https://example.com/d.js',
			'https://example.com/e.js',
		]);
	});

	it('mapRow で行を任意の出力型に変換する', async () => {
		await seedResource(db, 'https://example.com/a.js');

		const rows = await keysetPaginateById<{ id: number; url: string }, { id: number }>(
			db,
			'resource_items',
			(lastId) =>
				db('resource_items')
					.join('url_refs', 'url_refs.id', 'resource_items.url_id')
					.where('resource_items.id', '>', lastId)
					.orderBy('resource_items.id', 'asc')
					.limit(CHUNK_SIZE)
					.select('resource_items.id as id', 'url_refs.url as url'),
			(row) => ({ id: row.id }),
		);
		expect(rows).toEqual([{ id: expect.any(Number) }]);
	});

	it('onProgress を省略すると MAX(id) クエリを一切発行しない', async () => {
		await seedResource(db, 'https://example.com/a.js');
		const queries: string[] = [];
		db.on('query', (q: { sql: string }) => {
			queries.push(q.sql);
		});
		await paginateResourceUrls(db);
		expect(queries.some((sql) => /max/i.test(sql))).toBe(false);
	});

	it('onProgress を渡すと各チャンク後に呼ばれ、最終呼び出しは scannedUpToId===maxId になる', async () => {
		await seedResource(db, 'https://example.com/a.js');
		await seedResource(db, 'https://example.com/b.js');
		await seedResource(db, 'https://example.com/c.js');

		const calls: [number, number][] = [];
		await paginateResourceUrls(db, (scanned, max) => {
			calls.push([scanned, max]);
		});

		expect(calls.length).toBeGreaterThan(0);
		const [lastScanned, lastMax] = calls.at(-1)!;
		expect(lastScanned).toBe(lastMax);
		// 3 rows / chunk size 2 → 2 chunks, plus the trailing empty-chunk
		// call that confirms completion.
		expect(calls).toHaveLength(3);
	});
});
