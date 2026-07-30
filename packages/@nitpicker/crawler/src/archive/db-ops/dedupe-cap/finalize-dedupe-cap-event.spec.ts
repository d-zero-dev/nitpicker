import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { finalizeDedupeCapEvent } from './finalize-dedupe-cap-event.js';
import { insertDedupeCapEvent } from './insert-dedupe-cap-event.js';

describe('finalizeDedupeCapEvent', () => {
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
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('sets rejected_count on the target row, leaving every other column untouched', async () => {
		const id = await insertDedupeCapEvent(db, {
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});
		const before = await db('dedupe_cap_events').where({ id }).first();

		await finalizeDedupeCapEvent(db, id, 12_345);

		const after = await db('dedupe_cap_events').where({ id }).first();
		expect(after.rejected_count).toBe(12_345);
		expect(after.shape_key).toBe(before.shape_key);
		expect(after.sample_url).toBe(before.sample_url);
		expect(after.effective_threshold).toBe(before.effective_threshold);
		expect(after.observed_count).toBe(before.observed_count);
	});

	it('is idempotent — finalizing an already-finalized row a second time does not change rejected_count', async () => {
		const id = await insertDedupeCapEvent(db, {
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});
		await finalizeDedupeCapEvent(db, id, 100);
		await finalizeDedupeCapEvent(db, id, 999);

		const row = await db('dedupe_cap_events').where({ id }).first();
		expect(row.rejected_count).toBe(100);
	});

	it('does not affect a different, still-unfinalized row', async () => {
		const firstId = await insertDedupeCapEvent(db, {
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});
		const secondId = await insertDedupeCapEvent(db, {
			shapeKey: 'example.com/b/{n}/',
			sampleUrl: 'https://example.com/b/1/',
			bodyHash: Buffer.from('b'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 2000,
		});

		await finalizeDedupeCapEvent(db, firstId, 100);

		const secondRow = await db('dedupe_cap_events').where({ id: secondId }).first();
		expect(secondRow.rejected_count).toBeNull();
	});
});
