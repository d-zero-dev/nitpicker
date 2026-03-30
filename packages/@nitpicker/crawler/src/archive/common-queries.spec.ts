import type { Knex } from 'knex';

import knex from 'knex';
import { describe, it, expect } from 'vitest';

import { limitedPageIds, redirectTable } from './common-queries.js';
import { initSchema } from './init-schema.js';

describe('common-queries', () => {
	/**
	 *
	 */
	async function setupDb() {
		const db = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await initSchema(db);
		return db;
	}

	/**
	 *
	 * @param db
	 * @param url
	 * @param options
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

	describe('limitedPageIds', () => {
		it('returns page IDs ordered by order column with pagination', async () => {
			const db = await setupDb();

			await insertPage(db, 'https://example.com/a', { order: 2 });
			await insertPage(db, 'https://example.com/b', { order: 1 });
			await insertPage(db, 'https://example.com/c', { order: 3 });

			const result = await db.with('lp', limitedPageIds(2, 0)).select('*').from('lp');
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe(2); // order=1 first
			expect(result[1].id).toBe(1); // order=2 second
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
		});

		it('applies offset correctly', async () => {
			const db = await setupDb();

			await insertPage(db, 'https://example.com/a', { order: 1 });
			await insertPage(db, 'https://example.com/b', { order: 2 });
			await insertPage(db, 'https://example.com/c', { order: 3 });

			const result = await db.with('lp', limitedPageIds(10, 1)).select('*').from('lp');
			expect(result).toHaveLength(2);
		});
	});

	describe('redirectTable', () => {
		it('includes non-redirected pages when includeNull is true', async () => {
			const db = await setupDb();

			await insertPage(db, 'https://example.com/page', { order: 1 });

			const result = await db.with('rt', redirectTable(true)).select('*').from('rt');
			expect(result).toHaveLength(1);
			expect(result[0].from).toBe('https://example.com/page');
			expect(result[0].to).toBe('https://example.com/page');
		});

		it('excludes non-redirected pages when includeNull is false', async () => {
			const db = await setupDb();

			await insertPage(db, 'https://example.com/page', { order: 1 });

			const result = await db.with('rt', redirectTable(false)).select('*').from('rt');
			expect(result).toHaveLength(0);
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
		});
	});
});
