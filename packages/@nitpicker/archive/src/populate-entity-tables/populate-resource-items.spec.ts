import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populateRefTables } from '../populate-ref-tables/populate-refs.js';

import { populateResourceItems } from './populate-resource-items.js';
import { countRows } from './test-utils/count-rows.js';
import { setupMigrationDb } from './test-utils/setup-entities-db.js';

describe('populateResourceItems', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('copies resources 1:1 into resource_items with resolved ref ids', async () => {
		await db('resources').insert([
			{
				url: 'https://cdn.example.com/one.js',
				isExternal: 1,
				status: 200,
				statusText: 'OK',
				contentType: 'application/javascript',
				contentLength: 512,
				responseHeaders: '{"cache-control":"public"}',
				compress: 'gzip',
				cdn: 'cloudflare',
				source: 'crawled',
			},
		]);
		await populateRefTables(db);
		await populateResourceItems(db);
		const row = await db('resource_items').first();
		expect(row.id).toBe(1);
		expect(row.url_id).not.toBeNull();
		expect(row.content_type_id).not.toBeNull();
		expect(row.header_set_id).not.toBeNull();
		expect(row.compress).toBe('gzip');
		expect(row.cdn).toBe('cloudflare');
	});

	it('preserves resources.id verbatim', async () => {
		await db('resources').insert([
			{ id: 42, url: 'https://cdn.example.com/x.js' },
			{ id: 88, url: 'https://cdn.example.com/y.css' },
		]);
		await populateRefTables(db);
		await populateResourceItems(db);
		const idRows = await db('resource_items').select('id').orderBy('id');
		expect(idRows.map((r) => r.id)).toEqual([42, 88]);
	});

	it('is idempotent', async () => {
		await db('resources').insert([{ url: 'https://cdn.example.com/x.js' }]);
		await populateRefTables(db);
		await populateResourceItems(db);
		await populateResourceItems(db);
		expect(await countRows(db, 'resource_items')).toBe(1);
	});
});
