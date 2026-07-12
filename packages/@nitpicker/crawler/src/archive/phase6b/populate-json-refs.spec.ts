import { zstdDecompressSync } from 'node:zlib';

import knex from 'knex';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createPhase6ARefTables } from '../create-phase6a-ref-tables.js';
import { LibsqlDialect } from '../libsql-dialect.js';

import { computeContentHash } from './compute-content-hash.js';
import { populateJsonRefs } from './populate-json-refs.js';

/**
 * Minimal archive with just the `pages.meta_extras` source column and the
 * Phase 6-A ref tables.
 * @returns The connected Knex instance; the caller destroys it.
 */
async function setup(): Promise<ReturnType<typeof knex>> {
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
	});
	await db.schema.createTable('pages', (t) => {
		t.increments('id');
		t.string('url').notNullable();
		t.text('meta_extras').nullable();
	});
	await createPhase6ARefTables(db);
	return db;
}

describe('populateJsonRefs (json-refs-dedup)', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setup();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('inserts one row per meta_extras value', async () => {
		await db('pages').insert([
			{ url: '/a', meta_extras: JSON.stringify({ a: 1 }) },
			{ url: '/b', meta_extras: JSON.stringify({ b: 2 }) },
		]);
		await populateJsonRefs(db);
		const rows = await db('json_refs').select();
		expect(rows).toHaveLength(2);
	});

	it('dedupes identical meta_extras strings by hash', async () => {
		const same = JSON.stringify({ shared: true });
		await db('pages').insert([
			{ url: '/a', meta_extras: same },
			{ url: '/b', meta_extras: same },
			{ url: '/c', meta_extras: same },
		]);
		await populateJsonRefs(db);
		const rows = await db('json_refs').select();
		expect(rows).toHaveLength(1);
	});

	it('acceptance: same meta_extras inserted twice → same json_refs.id', async () => {
		const same = JSON.stringify({ hello: 'world' });
		await db('pages').insert([{ url: '/a', meta_extras: same }]);
		await populateJsonRefs(db);
		await db('pages').insert([{ url: '/b', meta_extras: same }]);
		await populateJsonRefs(db);
		const rows = await db('json_refs').select('id', 'hash');
		expect(rows).toHaveLength(1);
		const expectedHash = computeContentHash(same);
		expect(Buffer.from(rows[0]!.hash).equals(expectedHash)).toBe(true);
	});

	it('stores zstd-compressed body with size_raw / size_stored', async () => {
		const json = JSON.stringify({ padded: 'x'.repeat(2000) });
		await db('pages').insert([{ url: '/a', meta_extras: json }]);
		await populateJsonRefs(db);
		const row = await db('json_refs').first();
		expect(row.codec).toBe('zstd');
		expect(row.size_raw).toBe(Buffer.byteLength(json, 'utf8'));
		expect(row.size_stored).toBeGreaterThan(0);
		expect(row.size_stored).toBeLessThan(row.size_raw);
		const decoded = zstdDecompressSync(Buffer.from(row.json_text)).toString('utf8');
		expect(decoded).toBe(json);
	});

	it('skips null / empty meta_extras', async () => {
		await db('pages').insert([
			{ url: '/a', meta_extras: null },
			{ url: '/b', meta_extras: '' },
			{ url: '/c', meta_extras: '{}' },
		]);
		await populateJsonRefs(db);
		const rows = await db('json_refs').select();
		expect(rows).toHaveLength(1);
	});

	it('is idempotent (rerun does not duplicate)', async () => {
		await db('pages').insert([{ url: '/a', meta_extras: '{"k":1}' }]);
		await populateJsonRefs(db);
		await populateJsonRefs(db);
		const count = await db('json_refs').count<{ n: number }[]>('id as n');
		expect(Number(count[0]!.n)).toBe(1);
	});
});
