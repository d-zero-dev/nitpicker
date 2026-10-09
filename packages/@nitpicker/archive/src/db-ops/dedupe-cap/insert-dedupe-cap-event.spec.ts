import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { insertDedupeCapEvent } from './insert-dedupe-cap-event.js';

describe('insertDedupeCapEvent', () => {
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

	it('inserts exactly one row with rejected_count NULL', async () => {
		await insertDedupeCapEvent(db, {
			shapeKey: 'example.com/news/date/{n}/',
			sampleUrl: 'https://example.com/news/date/2024/',
			bodyHash: Buffer.from('hash'),
			effectiveThreshold: 50,
			observedCount: 100,
			detectedAt: 1000,
		});
		const rows = await db('dedupe_cap_events').select('*');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.shape_key).toBe('example.com/news/date/{n}/');
		expect(rows[0]?.sample_url).toBe('https://example.com/news/date/2024/');
		expect(rows[0]?.effective_threshold).toBe(50);
		expect(rows[0]?.observed_count).toBe(100);
		expect(rows[0]?.detected_at).toBe(1000);
		expect(rows[0]?.rejected_count).toBeNull();
	});

	it('returns the autoincremented id of the new row', async () => {
		const firstId = await insertDedupeCapEvent(db, {
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 10,
			observedCount: 10,
			detectedAt: 1000,
		});
		const secondId = await insertDedupeCapEvent(db, {
			shapeKey: 'example.com/b/{n}/',
			sampleUrl: 'https://example.com/b/1/',
			bodyHash: Buffer.from('b'),
			effectiveThreshold: 10,
			observedCount: 10,
			detectedAt: 2000,
		});
		expect(secondId).toBeGreaterThan(firstId);
	});

	it('allows multiple distinct shapes to be inserted in the same crawl', async () => {
		await insertDedupeCapEvent(db, {
			shapeKey: 'example.com/a/{n}/',
			sampleUrl: 'https://example.com/a/1/',
			bodyHash: Buffer.from('a'),
			effectiveThreshold: 10,
			observedCount: 10,
			detectedAt: 1000,
		});
		await insertDedupeCapEvent(db, {
			shapeKey: 'example.com/b/{n}/',
			sampleUrl: 'https://example.com/b/1/',
			bodyHash: Buffer.from('b'),
			effectiveThreshold: 10,
			observedCount: 10,
			detectedAt: 2000,
		});
		const rows = await db('dedupe_cap_events').select('*');
		expect(rows).toHaveLength(2);
	});
});
