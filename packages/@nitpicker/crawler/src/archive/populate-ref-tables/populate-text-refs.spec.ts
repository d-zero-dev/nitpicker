import knex from 'knex';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createRefTables } from '../create-ref-tables.js';
import { LibsqlDialect } from '../libsql-dialect.js';

import { computeContentHash } from './compute-content-hash.js';
import { populateTextRefs } from './populate-text-refs.js';
import { countRows } from './test-utils/count-rows.js';

/**
 * Sets up the source tables (anchors / images / pages) with the specific
 * text-shaped columns 0.13-2 harvests, plus every 0.13 ref
 * table. Column set is a strict subset of the real schema.
 * @returns The connected Knex instance; the caller destroys it.
 */
async function setup(): Promise<ReturnType<typeof knex>> {
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
	});
	await db.schema.createTable('anchors', (t) => {
		t.increments('id');
		t.integer('pageId').notNullable();
		t.integer('hrefId').notNullable();
		t.string('textContent').nullable();
	});
	await db.schema.createTable('images', (t) => {
		t.increments('id');
		t.integer('pageId').notNullable();
		t.string('alt').nullable();
	});
	await db.schema.createTable('pages', (t) => {
		t.increments('id');
		t.string('url').notNullable();
		t.string('title').nullable();
		t.text('description').nullable();
		t.text('keywords').nullable();
		t.text('robots_raw').nullable();
		t.string('og_title').nullable();
		t.text('og_description').nullable();
		t.string('twitter_title').nullable();
		t.text('twitter_description').nullable();
	});
	await createRefTables(db);
	return db;
}

describe('populateTextRefs (text-refs-dedup)', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setup();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('inserts one row per distinct text across all source columns', async () => {
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, textContent: 'Home' },
			{ pageId: 1, hrefId: 3, textContent: 'About' },
			{ pageId: 2, hrefId: 3, textContent: 'About' }, // dup
		]);
		await db('pages').insert([
			{ url: '/a', title: 'Home', description: 'Home page' },
			{ url: '/b', title: 'About' }, // reuses same text as anchor
		]);
		await populateTextRefs(db);
		const rows = await db('text_refs').select('text').orderBy('text');
		expect(rows.map((r) => r.text)).toEqual(['About', 'Home', 'Home page']);
	});

	it('stores the content hash on each row', async () => {
		await db('pages').insert([{ url: '/', title: 'Hello' }]);
		await populateTextRefs(db);
		const row = await db('text_refs').first();
		const expected = computeContentHash('Hello');
		expect(Buffer.from(row.hash).equals(expected)).toBe(true);
	});

	it('skips null and empty values', async () => {
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, textContent: null },
			{ pageId: 1, hrefId: 3, textContent: '' },
			{ pageId: 1, hrefId: 4, textContent: 'Kept' },
		]);
		await populateTextRefs(db);
		const rows = await db('text_refs').select('text');
		expect(rows.map((r) => r.text)).toEqual(['Kept']);
	});

	it('is idempotent (rerun does not duplicate)', async () => {
		await db('anchors').insert([{ pageId: 1, hrefId: 2, textContent: 'Home' }]);
		await populateTextRefs(db);
		await populateTextRefs(db);
		expect(await countRows(db, 'text_refs')).toBe(1);
	});

	it('harvests images.alt', async () => {
		await db('images').insert([
			{ pageId: 1, alt: 'Logo' },
			{ pageId: 1, alt: 'Photograph of a cat' },
		]);
		await populateTextRefs(db);
		const rows = await db('text_refs').select('text').orderBy('text');
		expect(rows.map((r) => r.text)).toEqual(['Logo', 'Photograph of a cat']);
	});

	it('harvests every documented pages text column', async () => {
		await db('pages').insert([
			{
				url: '/',
				title: 't1',
				description: 'd1',
				keywords: 'k1',
				robots_raw: 'r1',
				og_title: 'ot1',
				og_description: 'od1',
				twitter_title: 'tt1',
				twitter_description: 'td1',
			},
		]);
		await populateTextRefs(db);
		const rows = await db('text_refs').select('text').orderBy('text');
		expect(rows.map((r) => r.text).toSorted()).toEqual(
			['d1', 'k1', 'od1', 'ot1', 'r1', 't1', 'td1', 'tt1'].toSorted(),
		);
	});

	it('matches acceptance: count == distinct text across all covered columns', async () => {
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, textContent: 'Home' },
			{ pageId: 1, hrefId: 3, textContent: 'About' },
			{ pageId: 2, hrefId: 3, textContent: 'About' }, // dup
		]);
		await db('images').insert([{ pageId: 1, alt: 'Home' }]); // reuses "Home"
		await db('pages').insert([{ url: '/', title: 'Contact' }]);
		await populateTextRefs(db);
		// distinct union of {Home, About, Home, Contact} = {Home, About, Contact} = 3
		expect(await countRows(db, 'text_refs')).toBe(3);
	});
});
