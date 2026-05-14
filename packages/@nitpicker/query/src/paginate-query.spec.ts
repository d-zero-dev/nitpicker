import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { paginateQuery } from './paginate-query.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_paginate_query__');
const archiveFilePath = path.resolve(workingDir, 'paginate-query-test.nitpicker');

describe('paginateQuery', () => {
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
	});

	afterEach(async () => {
		const db = archive.getKnex();
		await db.schema.dropTableIfExists('items');
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	/**
	 * Sets up a fresh `items` table on the shared archive's Knex instance.
	 * Each test gets an isolated table because `afterEach` drops it.
	 */
	async function setupDb() {
		const db = archive.getKnex();
		await db.schema.createTable('items', (t) => {
			t.increments('id');
			t.string('name');
			t.integer('value');
		});
		return db;
	}

	it('returns paginated items with total count', async () => {
		const db = await setupDb();
		await db('items').insert([
			{ name: 'a', value: 1 },
			{ name: 'b', value: 2 },
			{ name: 'c', value: 3 },
		]);

		const result = await paginateQuery<{ name: string; value: number }, { name: string }>(
			{
				baseQuery: db('items'),
				countColumn: 'id',
				applySelect: (q) => q.select('name', 'value').orderBy('name'),
				limit: 2,
				offset: 0,
				mapRow: (row) => ({ name: row.name }),
			},
		);

		expect(result.items).toHaveLength(2);
		expect(result.total).toBe(3);
		expect(result.offset).toBe(0);
		expect(result.limit).toBe(2);
	});

	it('applies offset correctly', async () => {
		const db = await setupDb();
		await db('items').insert([
			{ name: 'a', value: 1 },
			{ name: 'b', value: 2 },
			{ name: 'c', value: 3 },
		]);

		const result = await paginateQuery<{ name: string }, { name: string }>({
			baseQuery: db('items'),
			countColumn: 'id',
			applySelect: (q) => q.select('name').orderBy('name'),
			limit: 10,
			offset: 1,
			mapRow: (row) => ({ name: row.name }),
		});

		expect(result.items).toHaveLength(2);
		expect(result.items[0].name).toBe('b');
		expect(result.total).toBe(3);
		expect(result.offset).toBe(1);
	});

	it('returns empty items for zero results', async () => {
		const db = await setupDb();

		const result = await paginateQuery<{ name: string }, { name: string }>({
			baseQuery: db('items'),
			countColumn: 'id',
			applySelect: (q) => q.select('name').orderBy('name'),
			limit: 10,
			offset: 0,
			mapRow: (row) => ({ name: row.name }),
		});

		expect(result.items).toHaveLength(0);
		expect(result.total).toBe(0);
	});

	it('returns empty items when offset exceeds total', async () => {
		const db = await setupDb();
		await db('items').insert([{ name: 'a', value: 1 }]);

		const result = await paginateQuery<{ name: string }, { name: string }>({
			baseQuery: db('items'),
			countColumn: 'id',
			applySelect: (q) => q.select('name').orderBy('name'),
			limit: 10,
			offset: 100,
			mapRow: (row) => ({ name: row.name }),
		});

		expect(result.items).toHaveLength(0);
		expect(result.total).toBe(1);
	});

	it('works with filtered base query', async () => {
		const db = await setupDb();
		await db('items').insert([
			{ name: 'a', value: 1 },
			{ name: 'b', value: 2 },
			{ name: 'c', value: 3 },
		]);

		const result = await paginateQuery<{ name: string; value: number }, { name: string }>(
			{
				baseQuery: db('items').where('value', '>=', 2),
				countColumn: 'id',
				applySelect: (q) => q.select('name', 'value').orderBy('name'),
				limit: 10,
				offset: 0,
				mapRow: (row) => ({ name: row.name }),
			},
		);

		expect(result.items).toHaveLength(2);
		expect(result.total).toBe(2);
		expect(result.items[0].name).toBe('b');
	});

	it('maps rows using mapRow function', async () => {
		const db = await setupDb();
		await db('items').insert([{ name: 'test', value: 42 }]);

		const result = await paginateQuery<
			{ name: string; value: number },
			{ label: string; doubled: number }
		>({
			baseQuery: db('items'),
			countColumn: 'id',
			applySelect: (q) => q.select('name', 'value').orderBy('name'),
			limit: 10,
			offset: 0,
			mapRow: (row) => ({ label: row.name, doubled: row.value * 2 }),
		});

		expect(result.items[0]).toEqual({ label: 'test', doubled: 84 });
	});
});
