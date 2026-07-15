import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populateHeaderTables } from '../populate-ref-tables/populate-header-tables.js';

import { resolveHeaderSets } from './resolve-header-sets.js';
import { setupMigrationDb } from './test-utils/setup-entities-db.js';

describe('resolveHeaderSets', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('resolves header_sets.id from the raw responseHeaders JSON', async () => {
		const raw = '{"content-type":"text/html"}';
		await db('pages').insert([
			{
				url: 'https://example.com/a',
				scraped: 1,
				isTarget: 1,
				responseHeaders: raw,
			},
		]);
		await populateHeaderTables(db);
		const map = await resolveHeaderSets(db, [raw]);
		expect(map.get(raw)).toBeTypeOf('number');
	});

	it('skips empty / sentinel strings', async () => {
		const map = await resolveHeaderSets(db, ['', 'null', '{}']);
		expect(map.size).toBe(0);
	});

	it('returns misses as absent keys', async () => {
		const map = await resolveHeaderSets(db, ['{"x-never":"seen"}']);
		expect(map.size).toBe(0);
	});

	it('falls back to raw_hash lookup when JSON key ordering differs but decoded content matches', async () => {
		// Regression guard for the PdM finding: `populateHeaderTables` stores exactly
		// one `raw_json_hash` per `raw_hash` equivalence class. A second
		// variant with identical decoded content but different key
		// ordering never has its `raw_json_hash` persisted — the primary
		// lookup misses, but the `raw_hash` fallback still points at the
		// shared header_sets row.
		const variantOne = '{"content-type":"text/html","cache-control":"no-store"}';
		const variantTwo = '{"cache-control":"no-store","content-type":"text/html"}';
		await db('pages').insert([
			{
				url: 'https://example.com/one',
				scraped: 1,
				isTarget: 1,
				responseHeaders: variantOne,
			},
			{
				url: 'https://example.com/two',
				scraped: 1,
				isTarget: 1,
				responseHeaders: variantTwo,
			},
		]);
		await populateHeaderTables(db);
		const map = await resolveHeaderSets(db, [variantOne, variantTwo]);
		expect(map.get(variantOne)).toBeTypeOf('number');
		expect(map.get(variantTwo)).toBe(map.get(variantOne));
	});
});
