import knex from 'knex';
import { describe, it, expect } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migrateRefTables } from './migrate-ref-tables.js';

/**
 * Simulates the shape of a pre-Phase-6A archive: only the write-model
 * tables that predate this branch exist. Kept minimal — the migration
 * only checks for `pages`, not the full legacy schema.
 * @param db - Knex instance already connected to an empty in-memory DB.
 */
async function seedLegacyArchive(db: ReturnType<typeof knex>): Promise<void> {
	await db.schema.createTable('pages', (t) => {
		t.increments('id');
		t.string('url').notNullable();
	});
}

describe('migrateRefTables', () => {
	const PHASE_6A_TABLES = [
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
	];

	it('creates all 10 0.13 tables on a legacy archive', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await seedLegacyArchive(db);

		for (const table of PHASE_6A_TABLES) {
			expect(await db.schema.hasTable(table), `${table} should be absent before`).toBe(
				false,
			);
		}

		await migrateRefTables(db);

		for (const table of PHASE_6A_TABLES) {
			expect(await db.schema.hasTable(table), `${table} should exist after`).toBe(true);
		}

		await db.destroy();
	});

	it('is idempotent (running twice does not error)', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await seedLegacyArchive(db);

		await migrateRefTables(db);
		await migrateRefTables(db);

		for (const table of PHASE_6A_TABLES) {
			expect(await db.schema.hasTable(table)).toBe(true);
		}

		await db.destroy();
	});

	it('is a no-op on an empty archive (no pages table)', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await migrateRefTables(db);

		for (const table of PHASE_6A_TABLES) {
			expect(await db.schema.hasTable(table)).toBe(false);
		}

		await db.destroy();
	});
});
