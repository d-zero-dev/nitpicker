import knex from 'knex';
import { describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migrateHtmlBlobTables } from './migrate-html-blob-tables.js';

/**
 * Builds a Knex instance against an in-memory libsql DB. Each test owns
 * its DB so the migration's idempotency, no-op, and "tables already
 * present" branches can be exercised in isolation.
 */
function openMemoryDb() {
	return knex({
		client: LibsqlDialect,
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
	});
}

describe('migrateHtmlBlobTables', () => {
	it('Adds page_html_blobs + page_html_ref + hash index to a pre-#75 archive', async () => {
		const db = openMemoryDb();
		try {
			// Seed a minimal "legacy" schema: just the `pages` table (with the
			// old `html` path column). `info` is NOT created because the
			// migration helper checks `pages`, not `info`.
			await db.schema.createTable('pages', (t) => {
				t.increments('id');
				t.string('url').notNullable();
				t.string('html');
			});

			await migrateHtmlBlobTables(db);

			expect(await db.schema.hasTable('page_html_blobs')).toBe(true);
			expect(await db.schema.hasTable('page_html_ref')).toBe(true);

			const indexes: { name: string }[] = await db.raw(
				"PRAGMA index_list('page_html_ref')",
			);
			expect(indexes.some((i) => i.name === 'idx_page_html_ref_hash')).toBe(true);

			const [{ sql }] = await db.raw(
				"SELECT sql FROM sqlite_master WHERE type='table' AND name='page_html_blobs'",
			);
			expect(sql).toMatch(/WITHOUT ROWID/);
			expect(sql).toMatch(/CHECK\(codec IN \('zstd', 'none'\)\)/);
		} finally {
			await db.destroy();
		}
	});

	it('Is a no-op when page_html_blobs already exists', async () => {
		const db = openMemoryDb();
		try {
			await db.schema.createTable('pages', (t) => {
				t.increments('id');
				t.string('url').notNullable();
			});
			await db.raw(`
				CREATE TABLE page_html_blobs (
					hash BLOB PRIMARY KEY,
					body BLOB NOT NULL,
					codec TEXT NOT NULL,
					size_raw INTEGER NOT NULL,
					size_stored INTEGER NOT NULL
				) WITHOUT ROWID
			`);

			// Idempotent: running the migration a second time on an
			// already-upgraded archive must not throw or recreate the
			// table (which would clear any populated rows).
			await db.raw(
				"INSERT INTO page_html_blobs(hash, body, codec, size_raw, size_stored) VALUES (X'00', X'01', 'zstd', 1, 1)",
			);

			await migrateHtmlBlobTables(db);

			const row = await db
				.from('page_html_blobs')
				.count<{ n: number }[]>('* as n')
				.first();
			expect(Number(row?.n)).toBe(1);
		} finally {
			await db.destroy();
		}
	});

	it('Is a no-op on an empty database (no pages table)', async () => {
		// An empty DB hits the second early-return — initSchema's
		// fresh-DB path is responsible for these tables, not the migration.
		const db = openMemoryDb();
		try {
			await migrateHtmlBlobTables(db);
			expect(await db.schema.hasTable('page_html_blobs')).toBe(false);
			expect(await db.schema.hasTable('page_html_ref')).toBe(false);
		} finally {
			await db.destroy();
		}
	});
});
