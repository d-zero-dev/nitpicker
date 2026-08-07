import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEntityTables } from '../../../create-entity-tables.js';
import { createRefTables } from '../../../create-ref-tables.js';
import { LibsqlDialect } from '../../../libsql-dialect.js';
import { createWriteRefCaches } from '../../_shared/create-write-ref-caches.js';

import { insertInventoryContentItems } from './insert-inventory-content-items.js';

describe('insertInventoryContentItems', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('is a no-op when the input array is empty', async () => {
		const caches = createWriteRefCaches();
		await insertInventoryContentItems({
			knex: db,
			caches,
			urls: [],
			row: { scraped: 0, is_external: 0, is_target: 0, source: 'inventory-seed' },
			opName: 'test-op',
		});
		const [count] = await db('content_items').count<{ c: number }[]>({ c: '*' });
		expect(Number(count.c)).toBe(0);
	});

	it('stamps the caller-provided row template on every inserted row and fills the write caches', async () => {
		const caches = createWriteRefCaches();
		await insertInventoryContentItems({
			knex: db,
			caches,
			urls: ['http://localhost/a', 'http://localhost/b'],
			row: {
				scraped: 1,
				is_external: 0,
				is_target: 0,
				is_skipped: 1,
				skip_reason: 'excluded',
				source: 'inventory-seed',
			},
			opName: 'test-op',
		});
		const rows = await db('content_items')
			.join('url_refs', 'url_refs.id', 'content_items.url_id')
			.select('url_refs.url', 'content_items.*')
			.orderBy('url_refs.url');
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row).toMatchObject({
				scraped: 1,
				is_skipped: 1,
				skip_reason: 'excluded',
				source: 'inventory-seed',
			});
		}
		expect(caches.urlIds.get('http://localhost/a')).toBeTypeOf('number');
		expect(caches.contentItems.get('http://localhost/a')).toMatchObject({
			source: 'inventory-seed',
		});
	});

	it('leaves an existing row untouched on url_id conflict (crawled-wins safety)', async () => {
		const caches = createWriteRefCaches();
		const [urlRef] = await db('url_refs')
			.insert({ url: 'http://localhost/kept' })
			.returning('id');
		await db('content_items').insert({
			url_id: urlRef!.id,
			scraped: 1,
			is_external: 0,
			is_target: 1,
			source: 'crawled',
		});

		await insertInventoryContentItems({
			knex: db,
			caches,
			urls: ['http://localhost/kept'],
			row: {
				scraped: 1,
				is_external: 0,
				is_target: 0,
				is_skipped: 1,
				skip_reason: 'excluded',
				source: 'inventory-seed',
			},
			opName: 'test-op',
		});

		const rows = await db('content_items').select('*');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ source: 'crawled', is_target: 1 });
		// The seeded row never had `is_skipped` set — the conflict-ignore
		// must leave it NULL, not stamp the template's `is_skipped: 1`.
		expect(rows[0].is_skipped).toBeNull();
	});
});
