import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { getCustomElementsOfPage } from './get-custom-elements-of-page.js';

describe('getCustomElementsOfPage', () => {
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
		await db('page_main_content_custom_elements').insert({
			pageId: page.id,
			order: 0,
			nodeName: 'MY-WIDGET',
			elementId: 'widget-1',
			classList: JSON.stringify(['foo']),
		});

		const [result] = await getCustomElementsOfPage(db, page.id);
		expect(result!.nodeName).toBe('MY-WIDGET');
		expect(result!.elementId).toBe('widget-1');
		expect(result!.classList).toBe('["foo"]');
	});

	it('returns an empty array when the page has no custom elements', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		const [page] = await db('content_items')
			.insert({ url_id: urlRef.id, is_external: 0, scraped: 1, is_target: 1 })
			.returning('id');

		expect(await getCustomElementsOfPage(db, page.id)).toEqual([]);
	});
});
