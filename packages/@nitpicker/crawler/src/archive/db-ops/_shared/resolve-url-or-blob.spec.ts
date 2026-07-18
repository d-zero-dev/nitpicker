import type { Knex } from 'knex';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { setupMigrationDb } from '../../populate-entity-tables/test-utils/setup-entities-db.js';

import { createWriteRefCaches } from './create-write-ref-caches.js';
import { resolveUrlOrBlob } from './resolve-url-or-blob.js';

/** A base64 data URI whose payload alone exceeds `DATA_URI_URL_REFS_LIMIT` (512). */
const LARGE_DATA_URI = `data:image/png;base64,${Buffer.alloc(600, 1).toString('base64')}`;

describe('resolveUrlOrBlob', () => {
	let db: Knex;
	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('routes a regular URL to url_refs', async () => {
		const caches = createWriteRefCaches();
		const slot = await resolveUrlOrBlob(db, caches, 'https://example.com/a.png');
		expect(slot.blob).toBeNull();
		expect(slot.url).not.toBeNull();
		const row = await db('url_refs').where('id', slot.url).first();
		expect(row.url).toBe('https://example.com/a.png');
	});

	it('routes a large data: URI to blob_refs', async () => {
		const caches = createWriteRefCaches();
		const slot = await resolveUrlOrBlob(db, caches, LARGE_DATA_URI);
		expect(slot.url).toBeNull();
		expect(slot.blob).not.toBeNull();
		const row = await db('blob_refs').where('id', slot.blob).first();
		expect(row).toBeDefined();
	});

	it('returns both null for an empty string', async () => {
		const caches = createWriteRefCaches();
		const slot = await resolveUrlOrBlob(db, caches, '');
		expect(slot).toEqual({ url: null, blob: null });
	});

	it('returns both null for null / undefined', async () => {
		const caches = createWriteRefCaches();
		expect(await resolveUrlOrBlob(db, caches, null)).toEqual({ url: null, blob: null });
		expect(await resolveUrlOrBlob(db, caches)).toEqual({ url: null, blob: null });
	});

	it('routes a short data: URI (at or below the threshold) to url_refs', async () => {
		const shortDataUri = 'data:image/png;base64,short';
		const caches = createWriteRefCaches();
		const slot = await resolveUrlOrBlob(db, caches, shortDataUri);
		expect(slot.blob).toBeNull();
		expect(slot.url).not.toBeNull();
	});
});
