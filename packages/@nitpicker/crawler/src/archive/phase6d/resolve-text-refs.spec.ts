import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populateTextRefs } from '../phase6b/populate-text-refs.js';

import { resolveTextRefs } from './resolve-text-refs.js';
import { setupPhase6DDb } from './test-utils/setup-phase6d-db.js';

describe('resolveTextRefs', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('returns text_refs.id for every present text', async () => {
		await db('pages').insert([
			{ url: 'https://example.com/a', scraped: 1, isTarget: 1, title: 'Page A' },
		]);
		await populateTextRefs(db);
		const map = await resolveTextRefs(db, ['Page A']);
		expect(map.get('Page A')).toBeTypeOf('number');
	});

	it('omits texts absent from text_refs', async () => {
		const map = await resolveTextRefs(db, ['Never inserted']);
		expect(map.size).toBe(0);
	});

	it('is a no-op for empty / null-like input', async () => {
		const map = await resolveTextRefs(db, ['']);
		expect(map.size).toBe(0);
	});
});
