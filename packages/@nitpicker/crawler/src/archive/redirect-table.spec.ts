import type { Knex } from 'knex';

import knex from 'knex';
import { describe, it, expect } from 'vitest';

import { redirectTable } from './redirect-table.js';

describe('redirectTable', () => {
	/**
	 * Creates an in-memory SQLite database with a minimal pages table
	 * (without WAL mode to avoid abort errors on destroy).
	 */
	async function setupDb() {
		const db = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await db.schema.createTable('pages', (t) => {
			t.increments('id');
			t.string('url', 8190).notNullable().unique();
			t.integer('redirectDestId').unsigned().references('pages.id').defaultTo(null);
			t.boolean('scraped').notNullable();
			t.boolean('isTarget').notNullable();
			t.boolean('isExternal');
			t.integer('order').unsigned().nullable();
		});
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
		const [id] = await db('pages').insert({
			url,
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			order: options.order ?? null,
			redirectDestId: options.redirectDestId ?? null,
		});
		return id;
	}

	it('includes non-redirected pages when includeNull is true', async () => {
		const db = await setupDb();

		await insertPage(db, 'https://example.com/page', { order: 1 });

		const result = await db.with('rt', redirectTable(true)).select('*').from('rt');
		expect(result).toHaveLength(1);
		expect(result[0].from).toBe('https://example.com/page');
		expect(result[0].to).toBe('https://example.com/page');

		// In-memory DB is automatically cleaned up by GC.
		// Explicit destroy() causes "aborted" errors due to Knex pool internals.
	});

	it('excludes non-redirected pages when includeNull is false', async () => {
		const db = await setupDb();

		await insertPage(db, 'https://example.com/page', { order: 1 });

		const result = await db.with('rt', redirectTable(false)).select('*').from('rt');
		expect(result).toHaveLength(0);

		// In-memory DB is automatically cleaned up by GC.
		// Explicit destroy() causes "aborted" errors due to Knex pool internals.
	});

	it('maps redirect source to destination', async () => {
		const db = await setupDb();

		const destId = await insertPage(db, 'https://example.com/dest', { order: 1 });
		await insertPage(db, 'https://example.com/src', {
			order: 2,
			redirectDestId: destId,
		});

		const result = await db.with('rt', redirectTable(false)).select('*').from('rt');
		expect(result).toHaveLength(1);
		expect(result[0].from).toBe('https://example.com/src');
		expect(result[0].to).toBe('https://example.com/dest');

		// In-memory DB is automatically cleaned up by GC.
		// Explicit destroy() causes "aborted" errors due to Knex pool internals.
	});

	it('returns empty result for empty table', async () => {
		const db = await setupDb();

		const result = await db.with('rt', redirectTable(true)).select('*').from('rt');
		expect(result).toHaveLength(0);

		// In-memory DB is automatically cleaned up by GC.
		// Explicit destroy() causes "aborted" errors due to Knex pool internals.
	});
});
