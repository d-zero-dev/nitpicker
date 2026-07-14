import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populateJsonRefs } from '../populate-ref-tables/populate-json-refs.js';

import { resolveJsonRefs } from './resolve-json-refs.js';
import { setupMigrationDb } from './test-utils/setup-entities-db.js';

describe('resolveJsonRefs', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('resolves json_refs.id for present meta_extras JSON strings', async () => {
		const raw = '{"custom":"payload"}';
		await db('pages').insert([
			{ url: 'https://example.com/a', scraped: 1, isTarget: 1, meta_extras: raw },
		]);
		await populateJsonRefs(db);
		const map = await resolveJsonRefs(db, [raw]);
		expect(map.get(raw)).toBeTypeOf('number');
	});

	it('skips empty / null inputs', async () => {
		const map = await resolveJsonRefs(db, ['']);
		expect(map.size).toBe(0);
	});
});
