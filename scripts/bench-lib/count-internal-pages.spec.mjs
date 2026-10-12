import knex from 'knex';
import { describe, it, expect, afterEach } from 'vitest';

import { LibsqlDialect } from '../../packages/@nitpicker/archive/lib/libsql-dialect.js';

import { countInternalPages } from './count-internal-pages.mjs';

describe('countInternalPages', () => {
	let db;

	afterEach(async () => {
		await db.destroy();
	});

	it('counts only crawled internal HTML pages that are not redirect sources', async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await db.raw('CREATE TABLE content_type_refs (id INTEGER PRIMARY KEY, raw TEXT)');
		await db.raw(
			'CREATE TABLE content_items (id INTEGER PRIMARY KEY, is_external INTEGER, scraped INTEGER, content_type_id INTEGER, redirect_dest_id INTEGER)',
		);
		await db('content_type_refs').insert([
			{ id: 1, raw: 'text/html' },
			{ id: 2, raw: 'application/pdf' },
		]);
		await db('content_items').insert([
			{ id: 1, is_external: 0, scraped: 1, content_type_id: 1, redirect_dest_id: null },
			{ id: 2, is_external: 0, scraped: 1, content_type_id: 1, redirect_dest_id: null },
			// external page
			{ id: 3, is_external: 1, scraped: 1, content_type_id: 1, redirect_dest_id: null },
			// discovered, never fetched
			{
				id: 4,
				is_external: 0,
				scraped: 0,
				content_type_id: null,
				redirect_dest_id: null,
			},
			// redirect source
			{ id: 5, is_external: 0, scraped: 1, content_type_id: 1, redirect_dest_id: 1 },
			// internal PDF
			{ id: 6, is_external: 0, scraped: 1, content_type_id: 2, redirect_dest_id: null },
		]);
		expect(await countInternalPages(db)).toBe(2);
	});
});
