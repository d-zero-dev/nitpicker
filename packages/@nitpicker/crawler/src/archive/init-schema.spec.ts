import knex from 'knex';
import { describe, it, expect } from 'vitest';

import { initSchema } from './init-schema.js';

describe('initSchema', () => {
	it('creates all required tables', async () => {
		const db = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const tables = [
			'info',
			'pages',
			'anchors',
			'images',
			'resources',
			'resources-referrers',
		];
		for (const table of tables) {
			const exists = await db.schema.hasTable(table);
			expect(exists, `table "${table}" should exist`).toBe(true);
		}
	});

	it('is idempotent (does not error on second call)', async () => {
		const db = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);
		await initSchema(db);

		const exists = await db.schema.hasTable('pages');
		expect(exists).toBe(true);
	});

	it('creates pages table with expected columns', async () => {
		const db = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const columns = await db.raw("PRAGMA table_info('pages')");
		const columnNames = columns.map((c: { name: string }) => c.name);
		expect(columnNames).toContain('id');
		expect(columnNames).toContain('url');
		expect(columnNames).toContain('redirectDestId');
		expect(columnNames).toContain('scraped');
		expect(columnNames).toContain('isTarget');
		expect(columnNames).toContain('isExternal');
		expect(columnNames).toContain('status');
		expect(columnNames).toContain('contentType');
		expect(columnNames).toContain('html');
		expect(columnNames).toContain('order');
	});

	it('creates resources table with expected columns', async () => {
		const db = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const columns = await db.raw("PRAGMA table_info('resources')");
		const columnNames = columns.map((c: { name: string }) => c.name);
		expect(columnNames).toContain('id');
		expect(columnNames).toContain('url');
		expect(columnNames).toContain('isExternal');
		expect(columnNames).toContain('contentType');
		expect(columnNames).toContain('compress');
		expect(columnNames).toContain('cdn');
	});
});
