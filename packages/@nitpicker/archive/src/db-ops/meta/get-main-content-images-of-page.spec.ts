import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { getMainContentImagesOfPage } from './get-main-content-images-of-page.js';

describe('getMainContentImagesOfPage', () => {
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
		await db('page_main_content_images').insert([
			{ pageId: page.id, order: 1, src: 'https://example.com/b.png', alt: 'B' },
			{ pageId: page.id, order: 0, src: 'https://example.com/a.png', alt: 'A' },
		]);

		const result = await getMainContentImagesOfPage(db, page.id);
		expect(result.map((r) => r.src)).toEqual([
			'https://example.com/a.png',
			'https://example.com/b.png',
		]);
	});

	it('returns an empty array when the page has no main-content images', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		const [page] = await db('content_items')
			.insert({ url_id: urlRef.id, is_external: 0, scraped: 1, is_target: 1 })
			.returning('id');

		expect(await getMainContentImagesOfPage(db, page.id)).toEqual([]);
	});
});
