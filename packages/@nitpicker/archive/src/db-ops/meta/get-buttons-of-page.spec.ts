import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { getButtonsOfPage } from './get-buttons-of-page.js';

describe('getButtonsOfPage', () => {
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

	it('returns rows in DOM traversal order', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		const [page] = await db('content_items')
			.insert({ url_id: urlRef.id, is_external: 0, scraped: 1, is_target: 1 })
			.returning('id');
		await db('page_main_content_buttons').insert({
			pageId: page.id,
			order: 0,
			nodeName: 'BUTTON',
			role: null,
			type: 'submit',
			text: 'Send',
			disabled: false,
		});

		const [result] = await getButtonsOfPage(db, page.id);
		expect(result!.nodeName).toBe('BUTTON');
		expect(result!.text).toBe('Send');
		expect(result!.disabled).toBe(0);
	});

	it('returns an empty array when the page has no buttons', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		const [page] = await db('content_items')
			.insert({ url_id: urlRef.id, is_external: 0, scraped: 1, is_target: 1 })
			.returning('id');

		expect(await getButtonsOfPage(db, page.id)).toEqual([]);
	});
});
