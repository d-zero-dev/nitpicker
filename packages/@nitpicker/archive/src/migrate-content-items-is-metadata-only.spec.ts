import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migrateContentItemsIsMetadataOnly } from './migrate-content-items-is-metadata-only.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file that simulates an archive
 * predating this feature: `content_items` exists (keyed by `id`) but has no
 * `is_metadata_only` column.
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
		'migrate-is-metadata-only-test.sqlite',
		'migrate-is-metadata-only-idempotent.sqlite',
		'migrate-is-metadata-only-empty.sqlite',
		'migrate-is-metadata-only-fresh.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migrateContentItemsIsMetadataOnly', () => {
	it('adds the is_metadata_only column to an existing content_items, backfilling 0', async () => {
		const { instance } = await buildLegacyContentItems(
			'migrate-is-metadata-only-test.sqlite',
		);
		await instance('content_items').insert({ source: 'crawled' });

		await migrateContentItemsIsMetadataOnly(instance);

		expect(await instance.schema.hasColumn('content_items', 'is_metadata_only')).toBe(
			true,
		);

		// Pre-existing row and columns survive untouched, new column backfills to 0.
		const [row] = await instance
			.select('source', 'is_metadata_only')
			.from('content_items');
		expect(row.source).toBe('crawled');
		expect(row.is_metadata_only).toBe(0);

		await instance.destroy();
	});

	it('never creates an index for the column (deliberate — see create-entity-tables.ts)', async () => {
		const { instance } = await buildLegacyContentItems(
			'migrate-is-metadata-only-fresh.sqlite',
		);

		await migrateContentItemsIsMetadataOnly(instance);

		const indexes = (await instance.raw(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'content_items'",
		)) as { name: string }[];
		expect(indexes.map((i) => i.name)).not.toContain(
			'idx_content_items_is_metadata_only',
		);

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyContentItems(
			'migrate-is-metadata-only-idempotent.sqlite',
		);

		await migrateContentItemsIsMetadataOnly(instance);
		await expect(migrateContentItemsIsMetadataOnly(instance)).resolves.toBeUndefined();

		expect(await instance.schema.hasColumn('content_items', 'is_metadata_only')).toBe(
			true,
		);

		await instance.destroy();
	});

	it('returns silently when content_items does not exist', async () => {
		const filename = path.resolve(workingDir, 'migrate-is-metadata-only-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await expect(migrateContentItemsIsMetadataOnly(instance)).resolves.toBeUndefined();

		await instance.destroy();
	});
});
