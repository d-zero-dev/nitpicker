import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migrateContentItemsAliasOfId } from './migrate-content-items-alias-of-id.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file that simulates an archive
 * predating this feature: `content_items` exists (keyed by `id`) but has no
 * `alias_of_id` column.
 * @param fileName - Name of the SQLite file relative to workingDir.
 * @returns The connected knex instance.
 */
async function buildLegacyContentItems(fileName: string) {
	const filename = path.resolve(workingDir, fileName);
	await fs.rm(filename, { force: true });
	const instance = knex({
		client: LibsqlDialect as never,
		connection: { filename },
		useNullAsDefault: true,
	});
	await instance.schema.createTable('content_items', (t) => {
		t.increments('id').primary();
		t.string('source');
	});
	return { instance, filename };
}

afterEach(async () => {
	for (const name of [
		'migrate-alias-of-id-test.sqlite',
		'migrate-alias-of-id-test-fk.sqlite',
		'migrate-alias-of-id-idempotent.sqlite',
		'migrate-alias-of-id-empty.sqlite',
		'migrate-alias-of-id-fresh.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migrateContentItemsAliasOfId', () => {
	it('adds the alias_of_id column and its index to an existing content_items', async () => {
		const { instance } = await buildLegacyContentItems('migrate-alias-of-id-test.sqlite');
		await instance('content_items').insert({ source: 'crawled' });

		await migrateContentItemsAliasOfId(instance);

		expect(await instance.schema.hasColumn('content_items', 'alias_of_id')).toBe(true);

		const indexes = (await instance.raw(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'content_items'",
		)) as { name: string }[];
		expect(indexes.map((i) => i.name)).toContain('idx_content_items_alias_of_id');

		// Pre-existing row and columns survive untouched, new column is NULL.
		const [row] = await instance.select('source', 'alias_of_id').from('content_items');
		expect(row.source).toBe('crawled');
		expect(row.alias_of_id).toBeNull();

		await instance.destroy();
	});

	it('retrofits the column as a self-referencing FK usable by later rows', async () => {
		const { instance } = await buildLegacyContentItems(
			'migrate-alias-of-id-test-fk.sqlite',
		);
		await migrateContentItemsAliasOfId(instance);

		const [target] = await instance('content_items')
			.insert({ source: 'crawled' })
			.returning('id');
		await instance('content_items').insert({
			source: 'crawled',
			alias_of_id: target.id ?? target,
		});

		const rows = await instance('content_items').select('id', 'alias_of_id');
		expect(rows).toHaveLength(2);

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyContentItems(
			'migrate-alias-of-id-idempotent.sqlite',
		);

		await migrateContentItemsAliasOfId(instance);
		await expect(migrateContentItemsAliasOfId(instance)).resolves.toBeUndefined();

		expect(await instance.schema.hasColumn('content_items', 'alias_of_id')).toBe(true);

		await instance.destroy();
	});

	it('creates the index even when the column already exists (fresh-archive path)', async () => {
		// Simulates a fresh archive: `createEntityTables`'s DDL already
		// defines `alias_of_id` on `content_items` (so `hasColumn` is true
		// from the start), but does NOT create the index itself — this is
		// the one path that must still create it. Regression guard for the
		// bug where index creation was nested inside the `!hasColumn` branch
		// and so never ran when the column pre-existed (same bug class as
		// `page_meta.body_hash`).
		const filename = path.resolve(workingDir, 'migrate-alias-of-id-fresh.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});
		await instance.schema.createTable('content_items', (t) => {
			t.increments('id').primary();
			t.integer('alias_of_id');
		});

		await migrateContentItemsAliasOfId(instance);

		const indexes = (await instance.raw(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'content_items'",
		)) as { name: string }[];
		expect(indexes.map((i) => i.name)).toContain('idx_content_items_alias_of_id');

		await instance.destroy();
	});

	it('returns silently when content_items does not exist', async () => {
		const filename = path.resolve(workingDir, 'migrate-alias-of-id-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await expect(migrateContentItemsAliasOfId(instance)).resolves.toBeUndefined();

		await instance.destroy();
	});
});
