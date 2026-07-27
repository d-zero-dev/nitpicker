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
	'page_main_content_headings',
	'page_main_content_images',
	'page_main_content_tables',
	'page_main_content_buttons',
	'page_main_content_iframes',
	'page_main_content_videos',
	'page_main_content_audios',
	'page_main_content_canvases',
	'inventory_runs',
	'network_outages',
	'analysis_text_refs',
	'analysis_violations',
	'page_html_blobs',
	'page_html_ref',
] as const;

const CONTENT_ITEMS_FK_TABLES = [
	'page_errors',
	'page_tags',
	'page_jsonld',
	'page_main_content_headings',
	'page_main_content_images',
	'page_main_content_tables',
	'page_main_content_buttons',
	'page_main_content_iframes',
	'page_main_content_videos',
	'page_main_content_audios',
	'page_main_content_canvases',
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

	it('gives analysis_violations nullable line/col columns on fresh creation', async () => {
		await createAdjunctTables(db);
		expect(await db.schema.hasColumn('analysis_violations', 'line')).toBe(true);
		expect(await db.schema.hasColumn('analysis_violations', 'col')).toBe(true);
	});

	it('declares network_outages with no FK and no secondary index', async () => {
		// Deliberately no index (see the DDL's JSDoc): a crawl session
		// produces at most a handful of rows, and every consumer reads the
		// whole table into memory rather than querying by column.
		await createAdjunctTables(db);
		expect(await db.schema.hasColumn('network_outages', 'started_at')).toBe(true);
		expect(await db.schema.hasColumn('network_outages', 'ended_at')).toBe(true);
		const parents = await fkParentTables(db, 'network_outages');
		expect(parents.size).toBe(0);
	});

	it('preserves existing network_outages rows across a second createAdjunctTables run', async () => {
		// The append-only journal must survive re-provisioning (e.g. a
		// self-healing partial archive) exactly like `inventory_runs` does.
		await createAdjunctTables(db);
		await db('network_outages').insert({
			started_at: 100,
			detected_at: 200,
			ended_at: null,
			probe_host: 'a.example',
			trigger_error_count: 5,
			trigger_host_count: 2,
		});
		await createAdjunctTables(db);
		const rows = await db('network_outages').select('*');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.started_at).toBe(100);
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
