import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migrateContentItemsDedupeCapEventId } from './migrate-content-items-dedupe-cap-event-id.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file that simulates an archive
 * predating this feature: `content_items` exists (keyed by `id`) but has no
 * `dedupe_cap_event_id` column.
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
		'migrate-dedupe-cap-event-id-test.sqlite',
		'migrate-dedupe-cap-event-id-idempotent.sqlite',
		'migrate-dedupe-cap-event-id-empty.sqlite',
		'migrate-dedupe-cap-event-id-fresh.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migrateContentItemsDedupeCapEventId', () => {
	it('adds the dedupe_cap_event_id column to an existing content_items', async () => {
		const { instance } = await buildLegacyContentItems(
			'migrate-dedupe-cap-event-id-test.sqlite',
		);
		await instance('content_items').insert({ source: 'crawled' });

		await migrateContentItemsDedupeCapEventId(instance);

		expect(await instance.schema.hasColumn('content_items', 'dedupe_cap_event_id')).toBe(
			true,
		);

		// Pre-existing row and columns survive untouched, new column is NULL.
		const [row] = await instance
			.select('source', 'dedupe_cap_event_id')
			.from('content_items');
		expect(row.source).toBe('crawled');
		expect(row.dedupe_cap_event_id).toBeNull();

		await instance.destroy();
	});

	it('never creates an index for the column (deliberate — see create-entity-tables.ts)', async () => {
		const { instance } = await buildLegacyContentItems(
			'migrate-dedupe-cap-event-id-fresh.sqlite',
		);

		await migrateContentItemsDedupeCapEventId(instance);

		const indexes = (await instance.raw(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'content_items'",
		)) as { name: string }[];
		expect(indexes.map((i) => i.name)).not.toContain(
			'idx_content_items_dedupe_cap_event_id',
		);

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyContentItems(
			'migrate-dedupe-cap-event-id-idempotent.sqlite',
		);

		await migrateContentItemsDedupeCapEventId(instance);
		await expect(migrateContentItemsDedupeCapEventId(instance)).resolves.toBeUndefined();

		expect(await instance.schema.hasColumn('content_items', 'dedupe_cap_event_id')).toBe(
			true,
		);

		await instance.destroy();
	});

	it('returns silently when content_items does not exist', async () => {
		const filename = path.resolve(workingDir, 'migrate-dedupe-cap-event-id-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await expect(migrateContentItemsDedupeCapEventId(instance)).resolves.toBeUndefined();

		await instance.destroy();
	});
});
