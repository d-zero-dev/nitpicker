import knex from 'knex';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createRefTables } from '../create-ref-tables.js';
import { LibsqlDialect } from '../libsql-dialect.js';

import { populateContentTypeRefs } from './populate-content-type-refs.js';
import { countRows } from './test-utils/count-rows.js';

/**
 * Sets up a minimal in-memory archive: the two source tables 0.13-0
 * scans, plus every 0.13 ref table (so `content_type_refs` exists as
 * the INSERT target). Full crawler schema is not needed — the populate
 * function only touches `pages.contentType`, `resources.contentType`, and
 * `content_type_refs`.
 * @returns The connected Knex instance; the caller destroys it.
 */
async function setup(): Promise<ReturnType<typeof knex>> {
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
	});
	await db.schema.createTable('pages', (t) => {
		t.increments('id');
		t.string('url').notNullable();
		t.string('contentType').nullable();
	});
	await db.schema.createTable('resources', (t) => {
		t.increments('id');
		t.string('url').notNullable();
		t.string('contentType').nullable();
	});
	await createRefTables(db);
	return db;
}

describe('populateContentTypeRefs', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setup();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('populates from pages.contentType', async () => {
		await db('pages').insert([
			{ url: '/a', contentType: 'text/html; charset=utf-8' },
			{ url: '/b', contentType: 'image/png' },
			{ url: '/c', contentType: null },
		]);
		await populateContentTypeRefs(db);
		const rows = await db('content_type_refs').select('raw', 'normalized', 'category');
		expect(rows).toEqual(
			expect.arrayContaining([
				{ raw: 'text/html; charset=utf-8', normalized: 'text/html', category: 'html' },
				{ raw: 'image/png', normalized: 'image/png', category: 'image' },
			]),
		);
		expect(rows).toHaveLength(2);
	});

	it('unions pages + resources content-types', async () => {
		await db('pages').insert([{ url: '/a', contentType: 'text/html' }]);
		await db('resources').insert([
			{ url: '/r1', contentType: 'application/javascript' },
			{ url: '/r2', contentType: 'text/html' },
		]);
		await populateContentTypeRefs(db);
		const rows = await db('content_type_refs').select('raw');
		expect(rows.map((r) => r.raw).toSorted()).toEqual([
			'application/javascript',
			'text/html',
		]);
	});

	it('is idempotent (re-run does not duplicate rows)', async () => {
		await db('pages').insert([{ url: '/a', contentType: 'text/html' }]);
		await populateContentTypeRefs(db);
		await populateContentTypeRefs(db);
		expect(await countRows(db, 'content_type_refs')).toBe(1);
	});

	it('skips null and empty content-types', async () => {
		await db('pages').insert([
			{ url: '/a', contentType: null },
			{ url: '/b', contentType: '' },
			{ url: '/c', contentType: 'text/html' },
		]);
		await populateContentTypeRefs(db);
		const rows = await db('content_type_refs').select('raw');
		expect(rows.map((r) => r.raw)).toEqual(['text/html']);
	});

	it('is a no-op when both source tables are empty', async () => {
		await populateContentTypeRefs(db);
		expect(await countRows(db, 'content_type_refs')).toBe(0);
	});

	it('strips C0 control characters from the normalized column', async () => {
		// jsdom occasionally lets a stray CR / TAB / NUL slip into a
		// Content-Type header. The `raw` column should retain the byte-for-
		// byte original; `normalized` must strip them so two rows for
		// the "same" logical MIME share a normalized value.
		const rawWithCr = 'text/html\r';
		const rawWithTab = '\ttext/html';
		await db('pages').insert([{ url: '/a', contentType: rawWithCr }]);
		await db('resources').insert([{ url: '/r', contentType: rawWithTab }]);
		await populateContentTypeRefs(db);
		const rows = await db('content_type_refs').select('raw', 'normalized').orderBy('raw');
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.normalized).toBe('text/html');
		}
	});
});
