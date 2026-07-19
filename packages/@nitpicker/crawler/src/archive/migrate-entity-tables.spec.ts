import knex from 'knex';
import { describe, it, expect } from 'vitest';

import { createRefTables } from './create-ref-tables.js';
import { LibsqlDialect } from './libsql-dialect.js';
import { migrateEntityTables } from './migrate-entity-tables.js';

/**
 * Simulates the shape of a pre-0.13 archive: the legacy write-model tables
 * exist, and the 0.13 ref tables have already been
 * migrated in (the migration ordering in `Database.connect` runs
 * `migrateRefTables` before `migrateEntityTables`).
 * @param db - Knex instance already connected to an empty in-memory DB.
 */
async function seedPreviousPhaseArchive(db: ReturnType<typeof knex>): Promise<void> {
	await db.schema.createTable('pages', (t) => {
		t.increments('id');
		t.string('url').notNullable();
	});
	await createRefTables(db);
}

describe('migrateEntityTables', () => {
	const PHASE_6C_TABLES = [
		'content_items',
		'page_meta',
		'resource_items',
		'anchor_edges',
		'resource_ref_edges',
		'image_items',
	];

	it('creates all 6 entity/edge tables on a pre-0.13 archive', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await seedPreviousPhaseArchive(db);

		for (const table of PHASE_6C_TABLES) {
			expect(await db.schema.hasTable(table), `${table} should be absent before`).toBe(
				false,
			);
		}

		await migrateEntityTables(db);

		for (const table of PHASE_6C_TABLES) {
			expect(await db.schema.hasTable(table), `${table} should exist after`).toBe(true);
		}

		await db.destroy();
	});

	it('produces schema that resolves every REFERENCES target with foreign_keys ON', async () => {
		// SQLite parses `REFERENCES <table>(<col>)` clauses but only
		// validates the target table exists when `foreign_keys` is ON at
		// INSERT time. Without an INSERT test that enables FKs, a DDL
		// typo like `REFERENCES url_ref(id)` (singular) would ship
		// undetected — the CREATE would succeed and every `hasTable`
		// assertion would still pass. This test forces every FK to
		// resolve by inserting one legal row into each 0.13 table.
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await db.raw('PRAGMA foreign_keys = ON');
		await seedPreviousPhaseArchive(db);
		await migrateEntityTables(db);

		const [urlRefPage] = await db.raw(
			"INSERT INTO url_refs (url) VALUES ('https://example.com/') RETURNING id",
		);
		const [urlRefRes] = await db.raw(
			"INSERT INTO url_refs (url) VALUES ('https://example.com/a.js') RETURNING id",
		);
		const [textRef] = await db.raw(
			'INSERT INTO text_refs (hash, text) VALUES (?, ?) RETURNING id',
			[Buffer.from('aa'.repeat(16), 'hex'), 'html>body>img'],
		);

		await db.raw(
			`INSERT INTO content_items
				(id, url_id, is_external, scraped, is_target)
				VALUES (1, ?, 0, 1, 1)`,
			[urlRefPage.id],
		);
		await db.raw('INSERT INTO page_meta (page_id) VALUES (1)');
		await db.raw(
			'INSERT INTO resource_items (id, url_id, is_external) VALUES (1, ?, 0)',
			[urlRefRes.id],
		);
		await db.raw(
			'INSERT INTO anchor_edges (page_id, href_page_id, count) VALUES (1, 1, 1)',
		);
		await db.raw('INSERT INTO resource_ref_edges (resource_id, page_id) VALUES (1, 1)');
		await db.raw(
			`INSERT INTO image_items
				(id, page_id, dom_path_text_id)
				VALUES (1, 1, ?)`,
			[textRef.id],
		);

		await db.destroy();
	});

	it('is idempotent (running twice does not error)', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});

		await seedPreviousPhaseArchive(db);

		await migrateEntityTables(db);
		await migrateEntityTables(db);

		for (const table of PHASE_6C_TABLES) {
			expect(await db.schema.hasTable(table)).toBe(true);
		}

		await db.destroy();
	});
});
