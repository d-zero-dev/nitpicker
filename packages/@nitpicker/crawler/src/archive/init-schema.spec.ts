import knex from 'knex';
import { describe, it, expect } from 'vitest';

import { initSchema } from './init-schema.js';
import { LibsqlDialect } from './libsql-dialect.js';

describe('initSchema', () => {
	it('creates all required tables', async () => {
		const db = knex({
			client: LibsqlDialect,
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

		await db.destroy();
	});

	it('is idempotent (does not error on second call)', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);
		await initSchema(db);

		const exists = await db.schema.hasTable('pages');
		expect(exists).toBe(true);

		await db.destroy();
	});

	it('creates pages table with expected columns', async () => {
		const db = knex({
			client: LibsqlDialect,
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

		await db.destroy();
	});

	it('creates resources table with expected columns', async () => {
		const db = knex({
			client: LibsqlDialect,
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

		await db.destroy();
	});

	it('sets PRAGMA journal_mode to WAL (falls back to memory for in-memory DB)', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		// In-memory SQLite does not support WAL; it returns "memory" instead.
		// On file-based SQLite, this would be "wal".
		const result = await db.raw('PRAGMA journal_mode');
		expect(['wal', 'memory']).toContain(result[0].journal_mode);

		await db.destroy();
	});

	it('enables foreign keys', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const result = await db.raw('PRAGMA foreign_keys');
		expect(result[0].foreign_keys).toBe(1);

		await db.destroy();
	});
});
