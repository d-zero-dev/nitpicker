import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { getMainContentTablesOfPage } from './get-main-content-tables-of-page.js';

describe('getMainContentTablesOfPage', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
		await createAdjunctTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('returns rows in DOM traversal order with boolean flags as raw 0/1', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		const [page] = await db('content_items')
			.insert({ url_id: urlRef.id, is_external: 0, scraped: 1, is_target: 1 })
			.returning('id');
		await db('page_main_content_tables').insert({
			pageId: page.id,
			order: 0,
			rows: 3,
			cols: 4,
			hasHeader: true,
			hasFooter: false,
			hasMergedCell: false,
		});

		const [result] = await getMainContentTablesOfPage(db, page.id);
		expect(result!.rows).toBe(3);
		expect(result!.cols).toBe(4);
		expect(result!.hasHeader).toBe(1);
		expect(result!.hasFooter).toBe(0);
	});

	it('returns an empty array when the page has no main-content tables', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		const [page] = await db('content_items')
			.insert({ url_id: urlRef.id, is_external: 0, scraped: 1, is_target: 1 })
			.returning('id');

		expect(await getMainContentTablesOfPage(db, page.id)).toEqual([]);
	});
});
