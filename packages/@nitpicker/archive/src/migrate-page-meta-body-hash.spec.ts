import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migratePageMetaBodyHash } from './migrate-page-meta-body-hash.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file that simulates an archive
 * predating this feature: `page_meta` exists (keyed by `page_id`) but has no
 * `body_hash` column.
 * @param fileName - Name of the SQLite file relative to workingDir.
 * @returns The connected knex instance.
 */
async function buildLegacyPageMeta(fileName: string) {
	const filename = path.resolve(workingDir, fileName);
	await fs.rm(filename, { force: true });
	const instance = knex({
		client: LibsqlDialect as never,
		connection: { filename },
		useNullAsDefault: true,
	});
	await instance.schema.createTable('page_meta', (t) => {
		t.integer('page_id').primary();
		t.string('lang');
	});
	return { instance, filename };
}

afterEach(async () => {
	for (const name of [
		'migrate-body-hash-test.sqlite',
		'migrate-body-hash-idempotent.sqlite',
		'migrate-body-hash-empty.sqlite',
		'migrate-body-hash-fresh.sqlite',
		'migrate-body-hash-on-log.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migratePageMetaBodyHash', () => {
	it('adds the body_hash column and its index to an existing page_meta', async () => {
		const { instance } = await buildLegacyPageMeta('migrate-body-hash-test.sqlite');
		await instance('page_meta').insert({ page_id: 1, lang: 'ja' });

		await migratePageMetaBodyHash(instance);

		expect(await instance.schema.hasColumn('page_meta', 'body_hash')).toBe(true);

		const indexes = (await instance.raw(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'page_meta'",
		)) as { name: string }[];
		expect(indexes.map((i) => i.name)).toContain('idx_page_meta_body_hash');

		// Pre-existing row and columns survive untouched, new column is NULL.
		const [row] = await instance.select('lang', 'body_hash').from('page_meta');
		expect(row.lang).toBe('ja');
		expect(row.body_hash).toBeNull();

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyPageMeta('migrate-body-hash-idempotent.sqlite');

		await migratePageMetaBodyHash(instance);
		await expect(migratePageMetaBodyHash(instance)).resolves.toBeUndefined();

		expect(await instance.schema.hasColumn('page_meta', 'body_hash')).toBe(true);

		await instance.destroy();
	});

	it('creates the index even when the column already exists (fresh-archive path)', async () => {
		// Simulates a fresh archive: `createEntityTables`'s DDL already
		// defines `body_hash` on `page_meta` (so `hasColumn` is true from the
		// start), but does NOT create the index itself — this is the one
		// path that must still create it. Regression guard for the bug where
		// index creation was nested inside the `!hasColumn` branch and so
		// never ran when the column pre-existed.
		const filename = path.resolve(workingDir, 'migrate-body-hash-fresh.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});
		await instance.schema.createTable('page_meta', (t) => {
			t.integer('page_id').primary();
			t.binary('body_hash');
		});

		await migratePageMetaBodyHash(instance);

		const indexes = (await instance.raw(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'page_meta'",
		)) as { name: string }[];
		expect(indexes.map((i) => i.name)).toContain('idx_page_meta_body_hash');

		await instance.destroy();
	});

	it('routes the migration notice through onLog instead of console.error when provided (issue #294)', async () => {
		const { instance } = await buildLegacyPageMeta('migrate-body-hash-on-log.sqlite');
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const onLog = vi.fn();

		await migratePageMetaBodyHash(instance, onLog);

		expect(onLog).toHaveBeenCalledWith('[migrate] page_meta.body_hash column added');
		expect(consoleErrorSpy).not.toHaveBeenCalled();

		await instance.destroy();
		consoleErrorSpy.mockRestore();
	});

	it('returns silently when page_meta does not exist', async () => {
		const filename = path.resolve(workingDir, 'migrate-body-hash-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await expect(migratePageMetaBodyHash(instance)).resolves.toBeUndefined();

		await instance.destroy();
	});
});
