import type { Knex } from 'knex';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { setupMigrationDb } from '../../populate-entity-tables/test-utils/setup-entities-db.js';

import { createWriteRefCaches } from './create-write-ref-caches.js';
import { upsertUrlRef } from './upsert-url-ref.js';

describe('upsertUrlRef', () => {
	let db: Knex;
	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('inserts a new URL with decomposed columns and returns its id', async () => {
		const caches = createWriteRefCaches();
		const id = await upsertUrlRef(db, caches, 'https://example.com:8443/a?x=1#frag');
		const row = await db('url_refs').where('id', id).first();
		expect(row.url).toBe('https://example.com:8443/a?x=1#frag');
		expect(row.scheme).toBe('https');
		expect(row.host).toBe('example.com');
		expect(row.port).toBe(8443);
		expect(row.path).toBe('/a');
		expect(row.query_hash).not.toBeNull();
		expect(row.fragment).toBe('frag');
	});

	it('returns the existing id on conflict instead of zero rows', async () => {
		// Locks in the FK-correctness invariant: `INSERT OR IGNORE …
		// RETURNING id` would return zero rows on conflict and leave the
		// caller with no id — the `ON CONFLICT DO UPDATE SET url = url`
		// no-op keeps RETURNING total.
		const first = createWriteRefCaches();
		const id = await upsertUrlRef(db, first, 'https://example.com/');
		const second = createWriteRefCaches();
		const again = await upsertUrlRef(db, second, 'https://example.com/');
		expect(again).toBe(id);
		const count = await db('url_refs').count({ n: '*' }).first();
		expect(Number(count?.n)).toBe(1);
	});

	it('serves repeat lookups from the cache without touching the DB', async () => {
		const caches = createWriteRefCaches();
		const id = await upsertUrlRef(db, caches, 'https://example.com/cached');
		// Poison the DB row: a cache hit must not re-read (or re-write) it.
		await db('url_refs').where('id', id).delete();
		const again = await upsertUrlRef(db, caches, 'https://example.com/cached');
		expect(again).toBe(id);
	});

	it('stores malformed URLs with null decomposed columns', async () => {
		const caches = createWriteRefCaches();
		const id = await upsertUrlRef(db, caches, 'not a url');
		const row = await db('url_refs').where('id', id).first();
		expect(row.url).toBe('not a url');
		expect(row.scheme).toBeNull();
		expect(row.host).toBeNull();
	});
});
