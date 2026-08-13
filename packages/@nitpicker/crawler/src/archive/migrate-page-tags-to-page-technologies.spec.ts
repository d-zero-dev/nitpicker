import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from './create-adjunct-tables.js';
import { createEntityTables } from './create-entity-tables.js';
import { createRefTables } from './create-ref-tables.js';
import { LibsqlDialect } from './libsql-dialect.js';
import { migratePageTagsToPageTechnologies } from './migrate-page-tags-to-page-technologies.js';

describe('migratePageTagsToPageTechnologies', () => {
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

		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/' })
			.returning('id');
		await db('content_items').insert({
			id: 1,
			url_id: urlRef.id,
			is_external: 0,
			scraped: 1,
			is_target: 1,
		});

		// Simulate a legacy page_tags table (createAdjunctTables no longer
		// creates it — this DDL mirrors the removed one exactly).
		await db.schema.createTable('page_tags', (t) => {
			t.increments('id');
			t.integer('pageId').notNullable();
			t.string('provider').notNullable();
			t.string('category');
			t.string('externalId');
			t.string('version');
			t.integer('confidence');
			t.json('categories');
			t.json('sources');
		});
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('returns silently when page_tags does not exist', async () => {
		await db.schema.dropTable('page_tags');
		await expect(migratePageTagsToPageTechnologies(db)).resolves.toBeUndefined();
	});

	it('converts page_tags rows into technology_signals + page_technologies, then drops page_tags', async () => {
		await db('page_tags').insert([
			{
				pageId: 1,
				provider: 'Vue.js',
				category: 'JavaScript frameworks',
				version: '3.4.0',
				confidence: 100,
				categories: JSON.stringify(['JavaScript frameworks']),
				sources: JSON.stringify([]),
			},
			{
				pageId: 1,
				provider: 'Google Analytics',
				category: 'Analytics',
				externalId: 'G-XXXX',
				categories: JSON.stringify(['Analytics']),
				sources: JSON.stringify([]),
			},
		]);

		await migratePageTagsToPageTechnologies(db);

		expect(await db.schema.hasTable('page_tags')).toBe(false);

		const signals = await db('technology_signals').select('*').orderBy('technology');
		expect(signals).toHaveLength(2);
		expect(signals[0]).toMatchObject({
			pageId: 1,
			technology: 'Google Analytics',
			signalType: 'wappalyzer',
		});
		expect(signals[1]).toMatchObject({
			pageId: 1,
			technology: 'Vue',
			signalType: 'wappalyzer',
			weight: 100,
		});

		const technologies = await db('page_technologies').select('*').orderBy('technology');
		expect(technologies).toHaveLength(2);
		expect(technologies[0]).toMatchObject({ pageId: 1, technology: 'Google Analytics' });
		expect(technologies[1]).toMatchObject({
			pageId: 1,
			technology: 'Vue',
			category: 'JavaScript frameworks',
			version: '3.4.0',
			confidence: 100,
		});
	});

	it('groups multiple page_tags rows for the same technology into one page_technologies row', async () => {
		await db('page_tags').insert([
			{
				pageId: 1,
				provider: 'Google Analytics',
				externalId: 'G-AAAA',
				categories: JSON.stringify(['Analytics']),
			},
			{
				pageId: 1,
				provider: 'Google Analytics',
				externalId: 'G-BBBB',
				categories: JSON.stringify(['Analytics']),
			},
		]);

		await migratePageTagsToPageTechnologies(db);

		const signals = await db('technology_signals').select('*');
		expect(signals).toHaveLength(2);
		const technologies = await db('page_technologies').select('*');
		expect(technologies).toHaveLength(1);
	});

	it('is idempotent — a second run is a no-op once page_tags is gone', async () => {
		await db('page_tags').insert({
			pageId: 1,
			provider: 'Vue.js',
			categories: JSON.stringify(['JavaScript frameworks']),
		});
		await migratePageTagsToPageTechnologies(db);
		await expect(migratePageTagsToPageTechnologies(db)).resolves.toBeUndefined();
		expect(await db('technology_signals').select('*')).toHaveLength(1);
	});

	it('is a no-op (besides the drop) when page_tags has no rows', async () => {
		await migratePageTagsToPageTechnologies(db);
		expect(await db.schema.hasTable('page_tags')).toBe(false);
		expect(await db('technology_signals').select('*')).toEqual([]);
		expect(await db('page_technologies').select('*')).toEqual([]);
	});
});
