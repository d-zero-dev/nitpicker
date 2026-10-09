import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEntityTables } from './create-entity-tables.js';
import { createRefTables } from './create-ref-tables.js';
import { dropLegacyTables } from './drop-legacy-tables.js';
import { LibsqlDialect } from './libsql-dialect.js';
import { setupLegacyFkDb } from './test-utils/setup-legacy-fk-db.js';

const LEGACY_TABLES = [
	'pages',
	'anchors',
	'images',
	'resources',
	'resources-referrers',
] as const;

describe('dropLegacyTables', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
		await setupLegacyFkDb(db);
		// Caller contract: enforcement must be OFF for the drop phase.
		await db.raw('PRAGMA foreign_keys = OFF');
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('rejects a caller that left PRAGMA foreign_keys ON', async () => {
		await db.raw('PRAGMA foreign_keys = ON');
		await expect(
			db.transaction(async (trx) => {
				await dropLegacyTables(trx);
			}),
		).rejects.toThrow(/PRAGMA foreign_keys is ON/);
		// Nothing was dropped — the guard fired before the first DROP.
		expect(await db.schema.hasTable('pages')).toBe(true);
	});

	it('drops all five legacy tables', async () => {
		await db.transaction(async (trx) => {
			await dropLegacyTables(trx);
		});
		for (const table of LEGACY_TABLES) {
			expect(await db.schema.hasTable(table), table).toBe(false);
		}
	});

	it('drops populated tables including a self-referential redirect chain', async () => {
		// `pages.redirectDestId` is a self-FK; the caller contract (PRAGMA
		// foreign_keys = OFF) exists precisely so rows like these cannot make
		// the drop fail on implicit-DELETE ordering.
		await db('pages').insert({
			id: 1,
			url: 'https://example.com/new',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
		});
		await db('pages').insert({
			id: 2,
			url: 'https://example.com/old',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			redirectDestId: 1,
		});
		await db('anchors').insert({ pageId: 1, hrefId: 2 });
		await db('resources').insert({ id: 1, url: 'https://example.com/a.css' });
		await db('resources-referrers').insert({ resourceId: 1, pageId: 1 });
		await db.transaction(async (trx) => {
			await dropLegacyTables(trx);
		});
		for (const table of LEGACY_TABLES) {
			expect(await db.schema.hasTable(table), table).toBe(false);
		}
	});

	it('is idempotent — missing tables are skipped', async () => {
		await db.transaction(async (trx) => {
			await dropLegacyTables(trx);
		});
		await expect(
			db.transaction(async (trx) => {
				await dropLegacyTables(trx);
			}),
		).resolves.toBeUndefined();
	});

	it('leaves the entity and adjunct tables intact', async () => {
		await db.transaction(async (trx) => {
			await dropLegacyTables(trx);
		});
		for (const table of [
			'content_items',
			'resource_items',
			'anchor_edges',
			'image_items',
			'page_errors',
			'page_html_ref',
		]) {
			expect(await db.schema.hasTable(table), table).toBe(true);
		}
	});
});
