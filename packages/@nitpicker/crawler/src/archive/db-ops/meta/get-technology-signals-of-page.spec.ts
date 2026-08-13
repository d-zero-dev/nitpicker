import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { getTechnologySignalsOfPage } from './get-technology-signals-of-page.js';

describe('getTechnologySignalsOfPage', () => {
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

	it('returns rows ordered by insertion (id) order', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		const [page] = await db('content_items')
			.insert({ url_id: urlRef.id, is_external: 0, scraped: 1, is_target: 1 })
			.returning('id');
		await db('technology_signals').insert([
			{
				pageId: page.id,
				technology: 'Next.js',
				signalType: 'html-marker',
				evidence: '__NEXT_DATA__',
				weight: 70,
			},
			{
				pageId: page.id,
				technology: 'Next.js',
				signalType: 'url-pattern',
				evidence: '/_next/',
				weight: 50,
			},
		]);

		const rows = await getTechnologySignalsOfPage(db, page.id);
		expect(rows.map((r) => r.signalType)).toEqual(['html-marker', 'url-pattern']);
		expect(rows[0]!.weight).toBe(70);
	});

	it('returns an empty array when the page has no technology signals', async () => {
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		const [page] = await db('content_items')
			.insert({ url_id: urlRef.id, is_external: 0, scraped: 1, is_target: 1 })
			.returning('id');

		expect(await getTechnologySignalsOfPage(db, page.id)).toEqual([]);
	});
});
