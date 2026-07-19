import type { Knex } from 'knex';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { setupMigrationDb } from '../../populate-entity-tables/test-utils/setup-entities-db.js';

import { createWriteRefCaches } from './create-write-ref-caches.js';
import { upsertContentTypeRef } from './upsert-content-type-ref.js';

describe('upsertContentTypeRef', () => {
	let db: Knex;
	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('inserts a new content type with derived normalized + category', async () => {
		const caches = createWriteRefCaches();
		const id = await upsertContentTypeRef(db, caches, 'text/html; charset=utf-8');
		const row = await db('content_type_refs').where('id', id).first();
		expect(row.raw).toBe('text/html; charset=utf-8');
		expect(row.normalized).toBe('text/html');
		expect(row.category).toBe('html');
	});

	it('dedupes on the raw natural key across cache instances', async () => {
		const id = await upsertContentTypeRef(db, createWriteRefCaches(), 'image/png');
		const again = await upsertContentTypeRef(db, createWriteRefCaches(), 'image/png');
		expect(again).toBe(id);
		const count = await db('content_type_refs').count({ n: '*' }).first();
		expect(Number(count?.n)).toBe(1);
	});

	it('serves repeat lookups from the cache without touching the DB', async () => {
		const caches = createWriteRefCaches();
		const id = await upsertContentTypeRef(db, caches, 'text/css');
		await db('content_type_refs').where('id', id).delete();
		const again = await upsertContentTypeRef(db, caches, 'text/css');
		expect(again).toBe(id);
	});
});
