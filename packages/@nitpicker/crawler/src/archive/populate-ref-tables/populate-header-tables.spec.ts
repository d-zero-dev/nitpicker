import knex from 'knex';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createRefTables } from '../create-ref-tables.js';
import { LibsqlDialect } from '../libsql-dialect.js';

import { populateHeaderTables } from './populate-header-tables.js';
import { countRows } from './test-utils/count-rows.js';

/**
 * Minimal archive with the two source tables that 0.13-5 scans, plus
 * the 0.13 ref tables (including the five header tables).
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
		t.json('responseHeaders').nullable();
	});
	await db.schema.createTable('resources', (t) => {
		t.increments('id');
		t.string('url').notNullable();
		t.json('responseHeaders').nullable();
	});
	await createRefTables(db);
	return db;
}

describe('populateHeaderTables', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setup();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('creates one header_sets row per distinct responseHeaders JSON string', async () => {
		const rawA = JSON.stringify({ 'content-type': 'text/html', date: 'D1' });
		const rawB = JSON.stringify({ 'content-type': 'text/html', date: 'D2' });
		await db('pages').insert([
			{ url: '/1', responseHeaders: rawA },
			{ url: '/2', responseHeaders: rawA }, // duplicate
			{ url: '/3', responseHeaders: rawB }, // different volatile
		]);
		await populateHeaderTables(db);
		expect(await countRows(db, 'header_sets')).toBe(2);
	});

	it('shares header_sets id between pages and resources for identical raw JSON', async () => {
		const raw = JSON.stringify({ 'content-type': 'text/html' });
		await db('pages').insert([{ url: '/a', responseHeaders: raw }]);
		await db('resources').insert([{ url: '/r', responseHeaders: raw }]);
		await populateHeaderTables(db);
		expect(await countRows(db, 'header_sets')).toBe(1);
	});

	it('inserts header_name_refs / header_value_refs / header_set_entries in lock-step', async () => {
		await db('pages').insert([
			{
				url: '/a',
				responseHeaders: JSON.stringify({
					'content-type': 'text/html',
					'cache-control': 'no-store',
				}),
			},
		]);
		await populateHeaderTables(db);
		const nameRows = await db('header_name_refs').select('name');
		expect(nameRows.map((r) => r.name).toSorted()).toEqual([
			'cache-control',
			'content-type',
		]);
		const valueRows = await db('header_value_refs').select('value');
		expect(valueRows.map((r) => r.value).toSorted()).toEqual(['no-store', 'text/html']);
		const entries = await db('header_set_entries').select();
		expect(entries).toHaveLength(2);
	});

	it('preserves multiple same-name headers via occurrence ordinals', async () => {
		await db('pages').insert([
			{
				url: '/a',
				responseHeaders: JSON.stringify({
					'set-cookie': ['session=abc', 'csrf=xyz'],
				}),
			},
		]);
		await populateHeaderTables(db);
		const entries = await db('header_set_entries')
			.join('header_name_refs', 'header_set_entries.name_id', 'header_name_refs.id')
			.select('name', 'occurrence')
			.orderBy('occurrence');
		expect(entries).toEqual([
			{ name: 'set-cookie', occurrence: 1 },
			{ name: 'set-cookie', occurrence: 2 },
		]);
	});

	it('populates header_flags with the correct bitmask + cache_policy', async () => {
		await db('pages').insert([
			{
				url: '/a',
				responseHeaders: JSON.stringify({
					'content-security-policy': "default-src 'self'",
					'strict-transport-security': 'max-age=31536000',
					'cache-control': 'no-store',
				}),
			},
		]);
		await populateHeaderTables(db);
		const row = await db('header_flags').first();
		expect(row.has_csp).toBe(1);
		expect(row.has_hsts).toBe(1);
		expect(row.has_x_frame_options).toBe(0);
		expect(row.cache_policy).toBe('no-store');
	});

	it('is idempotent across repeat runs', async () => {
		const raw = JSON.stringify({ 'content-type': 'text/html' });
		await db('pages').insert([{ url: '/a', responseHeaders: raw }]);
		await populateHeaderTables(db);
		await populateHeaderTables(db);
		expect(await countRows(db, 'header_sets')).toBe(1);
		expect(await countRows(db, 'header_set_entries', 'header_set_id')).toBe(1);
		expect(await countRows(db, 'header_flags', 'header_set_id')).toBe(1);
	});

	it('reuses one header_sets row when two rows differ only in JSON key ordering (same raw_hash)', async () => {
		// Same headers, different key insertion order — 0.13's UNIQUE
		// constraint on raw_hash would otherwise abort the second INSERT.
		const jsonA = '{"content-type":"text/html","cache-control":"no-store"}';
		const jsonB = '{"cache-control":"no-store","content-type":"text/html"}';
		await db('pages').insert([
			{ url: '/a', responseHeaders: jsonA },
			{ url: '/b', responseHeaders: jsonB },
		]);
		await populateHeaderTables(db);
		expect(await countRows(db, 'header_sets')).toBe(1);
	});

	it('skips null / empty / {} responseHeaders values', async () => {
		await db('pages').insert([
			{ url: '/a', responseHeaders: null },
			{ url: '/b', responseHeaders: '{}' },
			{ url: '/c', responseHeaders: '' },
			{ url: '/d', responseHeaders: JSON.stringify({ 'content-type': 'text/html' }) },
		]);
		await populateHeaderTables(db);
		expect(await countRows(db, 'header_sets')).toBe(1);
	});
});
