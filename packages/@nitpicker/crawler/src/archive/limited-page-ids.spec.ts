import type { Knex } from 'knex';

import knex from 'knex';
import { describe, it, expect } from 'vitest';

import { initSchema } from './init-schema.js';
import { LibsqlDialect } from './libsql-dialect.js';
import { limitedPageIds } from './limited-page-ids.js';

describe('limitedPageIds', () => {
	/**
	 * Creates an in-memory SQLite database with the archive schema.
	 */
	async function setupDb() {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await initSchema(db);
		return db;
	}

	/**
	 * Inserts a test page into the database.
	 * @param db - The Knex instance.
	 * @param url - The page URL.
	 * @param options - Optional order and redirectDestId.
	 * @param options.order
	 * @param options.redirectDestId
	 */
	async function insertPage(
		db: Knex,
		url: string,
		options: { order?: number; redirectDestId?: number | null } = {},
	) {
		const [urlRef] = await db('url_refs').insert({ url }).returning('id');
		const [row] = await db('content_items')
			.insert({
				url_id: urlRef.id,
				scraped: 1,
				is_target: 1,
				is_external: 0,
				crawl_order: options.order ?? null,
				redirect_dest_id: options.redirectDestId ?? null,
			})
			.returning('id');
		return row.id;
	}

	it('returns page IDs ordered by order column with pagination', async () => {
		const db = await setupDb();

		await insertPage(db, 'https://example.com/a', { order: 2 });
		await insertPage(db, 'https://example.com/b', { order: 1 });
		await insertPage(db, 'https://example.com/c', { order: 3 });

		const result = await db.with('lp', limitedPageIds(2, 0)).select('*').from('lp');
		expect(result).toHaveLength(2);
		expect(result[0].id).toBe(2); // order=1 first
		expect(result[1].id).toBe(1); // order=2 second

		await db.destroy();
	});

	it('excludes redirected pages', async () => {
		const db = await setupDb();

		const destId = await insertPage(db, 'https://example.com/dest', { order: 1 });
		await insertPage(db, 'https://example.com/redirect', {
			order: 2,
			redirectDestId: destId,
		});

		const result = await db.with('lp', limitedPageIds(10, 0)).select('*').from('lp');
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(destId);

		await db.destroy();
	});

	it('applies offset correctly', async () => {
		const db = await setupDb();

		await insertPage(db, 'https://example.com/a', { order: 1 });
		await insertPage(db, 'https://example.com/b', { order: 2 });
		await insertPage(db, 'https://example.com/c', { order: 3 });

		const result = await db.with('lp', limitedPageIds(10, 1)).select('*').from('lp');
		expect(result).toHaveLength(2);

		await db.destroy();
	});
});
