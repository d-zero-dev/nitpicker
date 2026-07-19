import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRefTables } from '../create-ref-tables.js';
import { LibsqlDialect } from '../libsql-dialect.js';

import { createHeaderTableCaches } from './create-header-table-caches.js';
import { decomposeHeaderSet } from './decompose-header-set.js';
import { upsertOneHeaderSet } from './upsert-one-header-set.js';

describe('upsertOneHeaderSet', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('inserts a new set with entries and flags, and dedups a repeat call to the same id', async () => {
		const caches = await createHeaderTableCaches(db);
		const decomposed = decomposeHeaderSet(
			JSON.stringify({ 'content-type': 'text/html', 'cache-control': 'no-store' }),
		)!;
		const first = await upsertOneHeaderSet(db, decomposed, caches);
		const second = await upsertOneHeaderSet(db, decomposed, caches);
		expect(second).toBe(first);
		const [entryCount] = await db('header_set_entries')
			.where('header_set_id', first)
			.count<{ c: number }[]>({ c: '*' });
		expect(Number(entryCount.c)).toBe(2);
		const flags = await db('header_flags').where('header_set_id', first).first();
		expect(flags).toBeDefined();
	});

	it('repairs entries and flags for a set whose prior run was interrupted mid-way', async () => {
		// Simulate a partial prior run: the header_sets row committed but its
		// entries / flags never did. A fresh process (fresh caches, so the
		// set id is preloaded from the DB but absent from
		// setIdsProcessedThisRun) must fill in the missing rows instead of
		// short-circuiting on the known set id.
		const seedCaches = await createHeaderTableCaches(db);
		const decomposed = decomposeHeaderSet(
			JSON.stringify({ 'content-type': 'text/html', etag: '"abc"' }),
		)!;
		const setId = await upsertOneHeaderSet(db, decomposed, seedCaches);
		await db('header_set_entries').where('header_set_id', setId).delete();
		await db('header_flags').where('header_set_id', setId).delete();

		const freshCaches = await createHeaderTableCaches(db);
		const repairedId = await upsertOneHeaderSet(db, decomposed, freshCaches);
		expect(repairedId).toBe(setId);
		const [entryCount] = await db('header_set_entries')
			.where('header_set_id', setId)
			.count<{ c: number }[]>({ c: '*' });
		expect(Number(entryCount.c)).toBe(2);
		const flags = await db('header_flags').where('header_set_id', setId).first();
		expect(flags).toBeDefined();
	});

	it('inserts an entry set larger than one insert chunk without dropping rows', async () => {
		// 501 distinct header names crosses the 500-rows-per-INSERT chunk
		// boundary; every entry must land.
		const headers: Record<string, string> = {};
		for (let n = 0; n < 501; n++) {
			headers[`x-bulk-${n}`] = `value-${n}`;
		}
		const caches = await createHeaderTableCaches(db);
		const decomposed = decomposeHeaderSet(JSON.stringify(headers))!;
		const setId = await upsertOneHeaderSet(db, decomposed, caches);
		const [entryCount] = await db('header_set_entries')
			.where('header_set_id', setId)
			.count<{ c: number }[]>({ c: '*' });
		expect(Number(entryCount.c)).toBe(501);
	});
});
