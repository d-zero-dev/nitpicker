import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEntityTables } from './create-entity-tables.js';
import { createRefTables } from './create-ref-tables.js';
import { createTemplateTables } from './create-template-tables.js';
import { LibsqlDialect } from './libsql-dialect.js';
import { fkParentTables } from './test-utils/fk-parent-tables.js';

const TEMPLATE_TABLES = [
	'page_templates',
	'page_template_clusters',
	'page_template_labels',
] as const;

describe('createTemplateTables', () => {
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

	it('creates every template table on an empty archive', async () => {
		await createTemplateTables(db);
		for (const table of TEMPLATE_TABLES) {
			expect(await db.schema.hasTable(table), table).toBe(true);
		}
	});

	it('is idempotent — a second run keeps existing rows', async () => {
		await createTemplateTables(db);
		await db('page_template_labels').insert({
			template_key: 'css:abc',
			section: 'events',
			ordinal: 1,
		});
		await createTemplateTables(db);
		const rows = await db('page_template_labels').select('*');
		expect(rows).toHaveLength(1);
	});

	it('declares content_items(id) as the only FK target of page_templates', async () => {
		await createTemplateTables(db);
		const parents = await fkParentTables(db, 'page_templates');
		expect([...parents]).toEqual(['content_items']);
	});

	it('declares page_template_clusters with no FK and the BLOB+codec+size shape', async () => {
		await createTemplateTables(db);
		const parents = await fkParentTables(db, 'page_template_clusters');
		expect(parents.size).toBe(0);
		for (const column of [
			'template_key',
			'member_count',
			'reason_json',
			'codec',
			'size_raw',
			'size_stored',
		]) {
			expect(await db.schema.hasColumn('page_template_clusters', column), column).toBe(
				true,
			);
		}
	});

	it('rejects an unrecognized page_template_clusters.codec value', async () => {
		await createTemplateTables(db);
		await expect(
			db('page_template_clusters').insert({
				template_key: 'css:abc',
				member_count: 1,
				reason_json: Buffer.from('{}'),
				codec: 'gzip',
				size_raw: 2,
				size_stored: 2,
			}),
		).rejects.toThrow(/CHECK constraint failed/);
	});

	it('rejects a duplicate page_template_clusters.template_key (PRIMARY KEY)', async () => {
		await createTemplateTables(db);
		const row = {
			template_key: 'css:abc123',
			member_count: 3,
			reason_json: Buffer.from('{}'),
			codec: 'zstd',
			size_raw: 2,
			size_stored: 2,
		};
		await db('page_template_clusters').insert(row);
		await expect(db('page_template_clusters').insert(row)).rejects.toThrow();
	});

	it('declares page_template_labels with no FK and a nullable section', async () => {
		await createTemplateTables(db);
		const parents = await fkParentTables(db, 'page_template_labels');
		expect(parents.size).toBe(0);
		await db('page_template_labels').insert({
			template_key: 'cluster:1',
			section: null,
			ordinal: 1,
		});
		const rows = await db('page_template_labels').select('*');
		expect(rows[0]?.section).toBeNull();
	});
});
