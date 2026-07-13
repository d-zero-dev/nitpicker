import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populatePhase6BRefs } from '../phase6b/populate-phase6b-refs.js';

import { resolveUrlRefs } from './resolve-url-refs.js';
import { setupPhase6DDb } from './test-utils/setup-phase6d-db.js';

describe('resolveUrlRefs', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('returns a map keyed by URL for every present url', async () => {
		await db('pages').insert([
			{ url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ url: 'https://example.com/b', scraped: 1, isTarget: 1 },
		]);
		await populatePhase6BRefs(db);
		const map = await resolveUrlRefs(db, [
			'https://example.com/a',
			'https://example.com/b',
		]);
		expect(map.get('https://example.com/a')).toBeTypeOf('number');
		expect(map.get('https://example.com/b')).toBeTypeOf('number');
	});

	it('omits missing URLs from the returned map', async () => {
		await db('pages').insert([{ url: 'https://example.com/a', scraped: 1, isTarget: 1 }]);
		await populatePhase6BRefs(db);
		const map = await resolveUrlRefs(db, [
			'https://example.com/a',
			'https://example.com/missing',
		]);
		expect(map.has('https://example.com/a')).toBe(true);
		expect(map.has('https://example.com/missing')).toBe(false);
	});

	it('is a no-op for empty input', async () => {
		const map = await resolveUrlRefs(db, []);
		expect(map.size).toBe(0);
	});

	it('dedupes duplicate URLs in the request set', async () => {
		await db('pages').insert([{ url: 'https://example.com/a', scraped: 1, isTarget: 1 }]);
		await populatePhase6BRefs(db);
		const map = await resolveUrlRefs(db, [
			'https://example.com/a',
			'https://example.com/a',
		]);
		expect(map.size).toBe(1);
	});
});
