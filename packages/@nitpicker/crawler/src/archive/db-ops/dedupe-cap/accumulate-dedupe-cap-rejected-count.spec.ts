import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { accumulateDedupeCapRejectedCount } from './accumulate-dedupe-cap-rejected-count.js';
import { insertDedupeCapEvent } from './insert-dedupe-cap-event.js';

describe('accumulateDedupeCapRejectedCount', () => {
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

	it('treats a still-NULL rejected_count as 0 and sets it to the given amount', async () => {
		const id = await insertDedupeCapEvent(db, {
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});

		await accumulateDedupeCapRejectedCount(db, 'example.com/a/{n}/', 7);

		const row = await db('dedupe_cap_events').where({ id }).first();
		expect(row.rejected_count).toBe(7);
	});

	it('adds onto an already-finalized rejected_count instead of overwriting it', async () => {
		const id = await insertDedupeCapEvent(db, {
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});
		await db('dedupe_cap_events').where({ id }).update({ rejected_count: 40 });

		await accumulateDedupeCapRejectedCount(db, 'example.com/a/{n}/', 5);

		const row = await db('dedupe_cap_events').where({ id }).first();
		expect(row.rejected_count).toBe(45);
	});

	it('only updates the row matching the given shape_key, leaving others untouched', async () => {
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

		await accumulateDedupeCapRejectedCount(db, 'example.com/a/{n}/', 3);

		const untouchedRow = await db('dedupe_cap_events').where({ id: secondId }).first();
		expect(untouchedRow.rejected_count).toBeNull();
		const updatedRow = await db('dedupe_cap_events').where({ id: firstId }).first();
		expect(updatedRow.rejected_count).toBe(3);
	});

	it('is a no-op when no row matches the shape_key', async () => {
		await expect(
			accumulateDedupeCapRejectedCount(db, 'example.com/nonexistent/{n}/', 3),
		).resolves.toBeUndefined();
	});
});
