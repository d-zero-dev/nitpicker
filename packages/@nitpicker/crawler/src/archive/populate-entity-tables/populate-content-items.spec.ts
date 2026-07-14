import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populateRefTables } from '../populate-ref-tables/populate-refs.js';

import { populateContentItems } from './populate-content-items.js';
import { countRows } from './test-utils/count-rows.js';
import { setupMigrationDb } from './test-utils/setup-entities-db.js';

describe('populateContentItems', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('copies pages 1:1 into content_items with resolved ref ids', async () => {
		await db('pages').insert([
			{
				url: 'https://example.com/a',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html; charset=utf-8',
				contentLength: 1024,
				responseHeaders: '{"content-type":"text/html"}',
				source: 'crawled',
				order: 1,
			},
			{
				url: 'https://example.com/b',
				scraped: 0,
				isTarget: 0,
				isExternal: 1,
				status: null,
				statusText: null,
				contentType: null,
				contentLength: null,
				responseHeaders: null,
				source: 'inventory-seed',
				order: 2,
			},
		]);
		await populateRefTables(db);
		await populateContentItems(db);
		const rows = await db('content_items').select().orderBy('id');
		expect(rows).toHaveLength(2);
		expect(rows[0]!.id).toBe(1);
		expect(rows[0]!.url_id).not.toBeNull();
		expect(rows[0]!.content_type_id).not.toBeNull();
		expect(rows[0]!.header_set_id).not.toBeNull();
		expect(rows[0]!.status).toBe(200);
		expect(rows[0]!.source).toBe('crawled');
		expect(rows[0]!.crawl_order).toBe(1);
		expect(rows[1]!.is_external).toBe(1);
		expect(rows[1]!.header_set_id).toBeNull();
		expect(rows[1]!.content_type_id).toBeNull();
	});

	it('preserves the exact pages.id as content_items.id', async () => {
		await db('pages').insert([
			{ id: 100, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ id: 250, url: 'https://example.com/b', scraped: 1, isTarget: 1 },
		]);
		await populateRefTables(db);
		await populateContentItems(db);
		const idRows = await db('content_items').select('id').orderBy('id');
		expect(idRows.map((r) => r.id)).toEqual([100, 250]);
	});

	it('propagates redirectDestId as-is (deferred FK)', async () => {
		await db('pages').insert([
			{ id: 10, url: 'https://example.com/redirect', scraped: 1, isTarget: 0 },
			{
				id: 20,
				url: 'https://example.com/dest',
				scraped: 1,
				isTarget: 1,
				redirectDestId: null,
			},
		]);
		// Redirect from id=10 to id=20 — with content_items DEFERRABLE FK
		// the source row can be inserted before the destination.
		await db('pages').where('id', 10).update({ redirectDestId: 20 });
		await populateRefTables(db);
		await db.transaction(async (trx) => {
			await populateContentItems(trx);
		});
		const redirect = await db('content_items').where('id', 10).first();
		expect(redirect.redirect_dest_id).toBe(20);
	});

	it('is idempotent (upsert on id)', async () => {
		await db('pages').insert([{ url: 'https://example.com/a', scraped: 1, isTarget: 1 }]);
		await populateRefTables(db);
		await populateContentItems(db);
		await populateContentItems(db);
		expect(await countRows(db, 'content_items')).toBe(1);
	});

	it('throws when url_refs.id is not resolvable (0.13-1 not run)', async () => {
		await db('pages').insert([{ url: 'https://example.com/a', scraped: 1, isTarget: 1 }]);
		// Deliberately skip populateRefTables — url_refs stays empty.
		await expect(populateContentItems(db)).rejects.toThrow(/url_refs\.id not resolved/);
	});

	it('throws when content_type_refs.id is not resolvable', async () => {
		await db('pages').insert([
			{
				url: 'https://example.com/a',
				scraped: 1,
				isTarget: 1,
				contentType: 'text/html',
			},
		]);
		// Only populate url_refs — content_type_refs stays empty.
		await db('url_refs').insert({ url: 'https://example.com/a' });
		await expect(populateContentItems(db)).rejects.toThrow(
			/content_type_refs\.id not resolved/,
		);
	});

	it('acceptance: count(content_items) equals count(pages)', async () => {
		await db('pages').insert([
			{ url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ url: 'https://example.com/b', scraped: 1, isTarget: 1 },
			{ url: 'https://example.com/c', scraped: 0, isTarget: 0 },
		]);
		await populateRefTables(db);
		await populateContentItems(db);
		const pagesCount = await countRows(db, 'pages');
		const contentItemsCount = await countRows(db, 'content_items');
		expect(contentItemsCount).toBe(pagesCount);
	});
});
