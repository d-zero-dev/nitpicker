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
			'page_html_blobs',
			'page_html_ref',
			// Phase 6-A staging tables (issue #190). Additive only —
			// present on every fresh archive but not read/written by
			// any consumer until later Phase 6 sub-issues land.
			'url_refs',
			'content_type_refs',
			'text_refs',
			'json_refs',
			'blob_refs',
			'header_name_refs',
			'header_value_refs',
			'header_sets',
			'header_set_entries',
			'header_flags',
			// Phase 6-C core entity / edge tables (issue #192). Same
			// additive-only status as Phase 6-A: created on every fresh
			// archive but not populated / read until later phases.
			'content_items',
			'page_meta',
			'resource_items',
			'anchor_edges',
			'resource_ref_edges',
			'image_items',
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
		// `html` was removed in #75 — bodies live in `page_html_ref` + `page_html_blobs`.
		expect(columnNames).not.toContain('html');
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

	it('creates page_html_blobs as WITHOUT ROWID with the expected columns', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const columns = await db.raw("PRAGMA table_info('page_html_blobs')");
		const names = columns.map((c: { name: string }) => c.name);
		expect(names).toEqual(['hash', 'body', 'codec', 'size_raw', 'size_stored']);

		// WITHOUT ROWID is detectable via sqlite_master.sql containing it.
		const [{ sql }] = await db.raw(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='page_html_blobs'",
		);
		expect(sql).toMatch(/WITHOUT ROWID/);

		await db.destroy();
	});

	it('creates page_html_ref with a hash index for reverse lookups', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const columns = await db.raw("PRAGMA table_info('page_html_ref')");
		const names = columns.map((c: { name: string }) => c.name);
		expect(names).toEqual(['page_id', 'hash']);

		const indexes: { name: string }[] = await db.raw(
			"PRAGMA index_list('page_html_ref')",
		);
		expect(indexes.some((i) => i.name === 'idx_page_html_ref_hash')).toBe(true);

		await db.destroy();
	});

	it('enforces UNIQUE on content_type_refs.raw', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		await db.raw(
			"INSERT INTO content_type_refs (raw, normalized, category) VALUES ('text/html; charset=utf-8', 'text/html', 'html')",
		);
		await expect(
			db.raw(
				"INSERT INTO content_type_refs (raw, normalized, category) VALUES ('text/html; charset=utf-8', 'text/html', 'html')",
			),
		).rejects.toThrow();

		await db.destroy();
	});

	it('enforces UNIQUE on header_name_refs.name and header_value_refs(hash, value)', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		await db.raw("INSERT INTO header_name_refs (name) VALUES ('content-type')");
		await expect(
			db.raw("INSERT INTO header_name_refs (name) VALUES ('content-type')"),
		).rejects.toThrow();

		const hash = Buffer.from('aa'.repeat(16), 'hex');
		await db.raw('INSERT INTO header_value_refs (hash, value) VALUES (?, ?)', [
			hash,
			'text/html',
		]);
		await expect(
			db.raw('INSERT INTO header_value_refs (hash, value) VALUES (?, ?)', [
				hash,
				'text/html',
			]),
		).rejects.toThrow();

		await db.destroy();
	});

	it('enforces UNIQUE on header_sets.raw_json_hash and header_sets.raw_hash', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const rawJsonHashA = Buffer.from('aa'.repeat(16), 'hex');
		const rawJsonHashB = Buffer.from('bb'.repeat(16), 'hex');
		const rawHashA = Buffer.from('cc'.repeat(16), 'hex');
		const rawHashB = Buffer.from('dd'.repeat(16), 'hex');
		const stableHash = Buffer.from('ee'.repeat(16), 'hex');
		await db.raw(
			'INSERT INTO header_sets (raw_json_hash, raw_hash, stable_hash, entry_count, stable_entry_count) VALUES (?, ?, ?, 0, 0)',
			[rawJsonHashA, rawHashA, stableHash],
		);
		await expect(
			db.raw(
				'INSERT INTO header_sets (raw_json_hash, raw_hash, stable_hash, entry_count, stable_entry_count) VALUES (?, ?, ?, 0, 0)',
				[rawJsonHashA, rawHashB, stableHash],
			),
		).rejects.toThrow();
		await expect(
			db.raw(
				'INSERT INTO header_sets (raw_json_hash, raw_hash, stable_hash, entry_count, stable_entry_count) VALUES (?, ?, ?, 0, 0)',
				[rawJsonHashB, rawHashA, stableHash],
			),
		).rejects.toThrow();

		await db.destroy();
	});

	it('creates url_refs with the expected columns and URL uniqueness', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const columns = await db.raw("PRAGMA table_info('url_refs')");
		const names = columns.map((c: { name: string }) => c.name);
		expect(names).toEqual([
			'id',
			'url',
			'scheme',
			'host',
			'port',
			'path',
			'query_hash',
			'fragment',
		]);

		await db.raw("INSERT INTO url_refs (url) VALUES ('https://example.com/')");
		await expect(
			db.raw("INSERT INTO url_refs (url) VALUES ('https://example.com/')"),
		).rejects.toThrow();

		await db.destroy();
	});

	it('creates text_refs with a (hash, text) composite UNIQUE', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const indexes: { name: string; unique: number }[] = await db.raw(
			"PRAGMA index_list('text_refs')",
		);
		const uniqueIndexes = indexes.filter((i) => i.unique === 1);
		expect(uniqueIndexes.length).toBeGreaterThan(0);

		const hashA = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
		const hashB = Buffer.from('fedcba9876543210fedcba9876543210', 'hex');
		await db.raw('INSERT INTO text_refs (hash, text) VALUES (?, ?)', [hashA, 'foo']);
		await db.raw('INSERT INTO text_refs (hash, text) VALUES (?, ?)', [hashA, 'bar']);
		await db.raw('INSERT INTO text_refs (hash, text) VALUES (?, ?)', [hashB, 'foo']);
		await expect(
			db.raw('INSERT INTO text_refs (hash, text) VALUES (?, ?)', [hashA, 'foo']),
		).rejects.toThrow();

		await db.destroy();
	});

	it('creates blob_refs with a regular rowid PK and UNIQUE hash', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const [{ sql }] = await db.raw(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='blob_refs'",
		);
		expect(sql).not.toMatch(/WITHOUT ROWID/i);

		const hash = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
		const body = Buffer.from('body-bytes');
		await db.raw(
			"INSERT INTO blob_refs (hash, body, codec, size_raw, size_stored) VALUES (?, ?, 'none', ?, ?)",
			[hash, body, body.length, body.length],
		);
		await expect(
			db.raw(
				"INSERT INTO blob_refs (hash, body, codec, size_raw, size_stored) VALUES (?, ?, 'none', ?, ?)",
				[hash, body, body.length, body.length],
			),
		).rejects.toThrow();

		await db.destroy();
	});

	it('rejects an invalid codec for json_refs / blob_refs', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const hash = Buffer.from('aa'.repeat(16), 'hex');
		await expect(
			db.raw(
				"INSERT INTO json_refs (hash, json_text, codec, size_raw, size_stored) VALUES (?, ?, 'gzip', 0, 0)",
				[hash, Buffer.from('{}')],
			),
		).rejects.toThrow();

		await db.destroy();
	});

	it('creates header_set_entries as WITHOUT ROWID', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const [{ sql }] = await db.raw(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='header_set_entries'",
		);
		expect(sql).toMatch(/WITHOUT ROWID/i);

		await db.destroy();
	});

	it('creates idx_header_sets_stable on header_sets(stable_hash)', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const indexes: { name: string }[] = await db.raw("PRAGMA index_list('header_sets')");
		expect(indexes.some((i) => i.name === 'idx_header_sets_stable')).toBe(true);

		const info: { name: string }[] = await db.raw(
			"PRAGMA index_info('idx_header_sets_stable')",
		);
		expect(info.map((c) => c.name)).toEqual(['stable_hash']);

		await db.destroy();
	});

	it('enforces the header_set_entries FK chain when PRAGMA foreign_keys = ON', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);
		// initSchema does not enable foreign_keys by itself (that lives in
		// applyConnectionPragmas). Enable it here so the REFERENCES clauses
		// on header_set_entries actually reject dangling parents — otherwise
		// a typo in the FK column name would silently pass the DDL tests.
		await db.raw('PRAGMA foreign_keys = ON');

		await expect(
			db.raw(
				'INSERT INTO header_set_entries (header_set_id, name_id, occurrence, value_id, is_volatile) VALUES (?, ?, ?, ?, ?)',
				[999, 1, 1, 1, 0],
			),
		).rejects.toThrow();

		await db.destroy();
	});

	it('creates header_flags keyed by header_set_id', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		const columns = await db.raw("PRAGMA table_info('header_flags')");
		const names = columns.map((c: { name: string }) => c.name);
		expect(names).toEqual([
			'header_set_id',
			'has_csp',
			'has_x_frame_options',
			'has_x_content_type_options',
			'has_hsts',
			'has_referrer_policy',
			'has_permissions_policy',
			'has_set_cookie',
			'cache_policy',
		]);

		await db.destroy();
	});

	it('does not modify existing pages / resources / images / anchors / resources-referrers schema', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await initSchema(db);

		// Sanity check the Phase 6-A DDL did not accidentally re-declare
		// any column on the legacy write-model tables. The exact column
		// lists here are pinned so a future accidental additive edit
		// (dropping a column, renaming, changing null-ability by
		// re-creating the table) would surface as a test failure.
		const pagesInfo = await db.raw("PRAGMA table_info('pages')");
		const pagesColumns = pagesInfo.map((c: { name: string }) => c.name);
		expect(pagesColumns).toContain('responseHeaders');
		expect(pagesColumns).not.toContain('url_id');
		expect(pagesColumns).not.toContain('header_set_id');

		const resourcesInfo = await db.raw("PRAGMA table_info('resources')");
		const resourcesColumns = resourcesInfo.map((c: { name: string }) => c.name);
		expect(resourcesColumns).toContain('responseHeaders');
		expect(resourcesColumns).not.toContain('url_id');
		expect(resourcesColumns).not.toContain('header_set_id');

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
