import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populateContentTypeRefs } from '../populate-ref-tables/populate-content-type-refs.js';

import { loadContentTypeRefs } from './resolve-content-type-refs.js';
import { setupMigrationDb } from './test-utils/setup-entities-db.js';

describe('loadContentTypeRefs', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('returns every content_type_refs row as raw → id', async () => {
		await db('pages').insert([
			{ url: 'https://example.com/a', scraped: 1, isTarget: 1, contentType: 'text/html' },
		]);
		await db('resources').insert([
			{ url: 'https://cdn.example.com/x.css', contentType: 'text/css' },
		]);
		await populateContentTypeRefs(db);
		const map = await loadContentTypeRefs(db);
		expect(map.get('text/html')).toBeTypeOf('number');
		expect(map.get('text/css')).toBeTypeOf('number');
	});

	it('returns an empty map when the dictionary is empty', async () => {
		const map = await loadContentTypeRefs(db);
		expect(map.size).toBe(0);
	});
});
