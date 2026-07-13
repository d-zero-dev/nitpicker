import knex from 'knex';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createPhase6ARefTables } from '../create-phase6a-ref-tables.js';
import { LibsqlDialect } from '../libsql-dialect.js';

import { populatePhase6BRefs } from './populate-phase6b-refs.js';
import { countRows } from './test-utils/count-rows.js';

/**
 * Sets up an in-memory archive with the write-model tables that Phase
 * 6-B reads (`pages`, `resources`, `anchors`, `images`) plus every
 * Phase 6-A ref/header table. Rows are inserted by the test bodies.
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
		t.json('responseHeaders').nullable();
		t.string('title').nullable();
		t.text('description').nullable();
		t.text('keywords').nullable();
		t.text('robots_raw').nullable();
		t.string('og_title').nullable();
		t.text('og_description').nullable();
		t.string('twitter_title').nullable();
		t.text('twitter_description').nullable();
		t.string('canonical').nullable();
		t.string('og_url').nullable();
		t.string('og_image').nullable();
		t.string('icon_href').nullable();
		t.string('appleTouchIcon_href').nullable();
		t.string('amphtml').nullable();
		t.string('manifest').nullable();
		t.string('twitter_image').nullable();
		t.text('meta_extras').nullable();
	});
	await db.schema.createTable('resources', (t) => {
		t.increments('id');
		t.string('url').notNullable();
		t.string('contentType').nullable();
		t.json('responseHeaders').nullable();
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
		t.text('src').nullable();
		t.text('currentSrc').nullable();
		t.string('alt').nullable();
	});
	await createPhase6ARefTables(db);
	return db;
}

describe('populatePhase6BRefs (orchestrator)', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setup();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('is a no-op on an empty archive', async () => {
		await populatePhase6BRefs(db);
		const tablesToCheck: readonly { table: string; countColumn: string }[] = [
			{ table: 'url_refs', countColumn: 'id' },
			{ table: 'content_type_refs', countColumn: 'id' },
			{ table: 'text_refs', countColumn: 'id' },
			{ table: 'json_refs', countColumn: 'id' },
			{ table: 'blob_refs', countColumn: 'id' },
			{ table: 'header_name_refs', countColumn: 'id' },
			{ table: 'header_value_refs', countColumn: 'id' },
			{ table: 'header_sets', countColumn: 'id' },
			{ table: 'header_set_entries', countColumn: 'header_set_id' },
			{ table: 'header_flags', countColumn: 'header_set_id' },
		];
		for (const { table, countColumn } of tablesToCheck) {
			expect(await countRows(db, table, countColumn), `${table} should be empty`).toBe(0);
		}
	});

	it('fully populates every ref table for a small realistic archive', async () => {
		await db('pages').insert([
			{
				url: 'https://example.com/a',
				contentType: 'text/html; charset=utf-8',
				title: 'Home',
				canonical: 'https://example.com/a',
				meta_extras: JSON.stringify({ some: 'extra' }),
				responseHeaders: JSON.stringify({
					'content-type': 'text/html',
					'cache-control': 'no-store',
					date: 'D1',
				}),
			},
		]);
		await db('resources').insert([
			{
				url: 'https://cdn.example.com/one.js',
				contentType: 'application/javascript',
				responseHeaders: JSON.stringify({
					'content-type': 'application/javascript',
				}),
			},
		]);
		await db('anchors').insert([
			{ pageId: 1, hrefId: 1, textContent: 'Home' },
			{ pageId: 1, hrefId: 1, textContent: 'About' },
		]);
		await db('images').insert([
			{ pageId: 1, src: 'https://example.com/logo.png', alt: 'Logo' },
		]);

		await populatePhase6BRefs(db);

		expect(await countRows(db, 'content_type_refs')).toBe(2);
		// URLs: pages.url + pages.canonical (dedup as same value) + resources.url + images.src = 3 distinct.
		expect(await countRows(db, 'url_refs')).toBe(3);
		expect(await countRows(db, 'text_refs')).toBe(3);
		expect(await countRows(db, 'json_refs')).toBe(1);
		expect(await countRows(db, 'header_sets')).toBe(2);
		expect(await countRows(db, 'header_flags', 'header_set_id')).toBe(2);
	});

	it('is idempotent across repeated runs', async () => {
		await db('pages').insert([
			{
				url: 'https://example.com/a',
				contentType: 'text/html',
				title: 'Home',
				responseHeaders: JSON.stringify({ 'content-type': 'text/html' }),
			},
		]);
		await populatePhase6BRefs(db);
		await populatePhase6BRefs(db);
		expect(await countRows(db, 'content_type_refs')).toBe(1);
		expect(await countRows(db, 'url_refs')).toBe(1);
		expect(await countRows(db, 'text_refs')).toBe(1);
		expect(await countRows(db, 'header_sets')).toBe(1);
	});
});
