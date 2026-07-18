import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from './create-adjunct-tables.js';
import { createEntityTables } from './create-entity-tables.js';
import { createRefTables } from './create-ref-tables.js';
import { LibsqlDialect } from './libsql-dialect.js';
import { fkParentTables } from './test-utils/fk-parent-tables.js';

const ADJUNCT_TABLES = [
	'page_errors',
	'crawl_errors',
	'page_tags',
	'page_jsonld',
	'inventory_runs',
	'analysis_text_refs',
	'analysis_violations',
	'page_html_blobs',
	'page_html_ref',
] as const;

const CONTENT_ITEMS_FK_TABLES = [
	'page_errors',
	'page_tags',
	'page_jsonld',
	'analysis_violations',
	'page_html_ref',
] as const;

describe('createAdjunctTables', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('creates every adjunct table on an empty archive', async () => {
		await createAdjunctTables(db);
		for (const table of ADJUNCT_TABLES) {
			expect(await db.schema.hasTable(table), table).toBe(true);
		}
	});

	it('is idempotent — a second run leaves the schema intact', async () => {
		await createAdjunctTables(db);
		await createAdjunctTables(db);
		for (const table of ADJUNCT_TABLES) {
			expect(await db.schema.hasTable(table), table).toBe(true);
		}
	});

	it('declares content_items(id) as the FK target of every page-scoped table', async () => {
		await createAdjunctTables(db);
		for (const table of CONTENT_ITEMS_FK_TABLES) {
			const parents = await fkParentTables(db, table);
			expect(parents.has('content_items'), `${table} → content_items`).toBe(true);
			expect(parents.has('pages'), `${table} must not reference pages`).toBe(false);
		}
	});

	it('fills only the missing tables on a partially-provisioned archive', async () => {
		// Simulate an archive where `page_tags` was provisioned by an earlier
		// path (its FK target does not matter here) but the rest is absent.
		await db.raw(`
			CREATE TABLE page_tags (
				id INTEGER PRIMARY KEY,
				pageId INTEGER NOT NULL,
				provider TEXT NOT NULL,
				marker TEXT
			)
		`);
		await createAdjunctTables(db);
		for (const table of ADJUNCT_TABLES) {
			expect(await db.schema.hasTable(table), table).toBe(true);
		}
		// The pre-existing table was left untouched (its custom column survives).
		expect(await db.schema.hasColumn('page_tags', 'marker')).toBe(true);
	});

	it('enforces the content_items FK on insert (PRAGMA foreign_keys = ON)', async () => {
		await db.raw('PRAGMA foreign_keys = ON');
		await createAdjunctTables(db);
		await expect(
			db('page_errors').insert({
				pageId: 12_345,
				phase: 'test',
				message: 'orphan',
				createdAt: 0,
			}),
		).rejects.toThrow(/FOREIGN KEY constraint failed/);
	});
});
