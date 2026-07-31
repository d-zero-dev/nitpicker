import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { insertDedupeCapEvent } from './insert-dedupe-cap-event.js';
import { listDedupeCapShapeKeys } from './list-dedupe-cap-shape-keys.js';

describe('listDedupeCapShapeKeys', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('legacy archive（dedupe_cap_eventsテーブルなし）は空配列を返す', async () => {
		expect(await listDedupeCapShapeKeys(db)).toEqual([]);
	});

	it('記録が無ければ空配列を返す', async () => {
		await createAdjunctTables(db);
		expect(await listDedupeCapShapeKeys(db)).toEqual([]);
	});

	it('記録済みのshape_keyを重複なく返す', async () => {
		await createAdjunctTables(db);
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

		const shapeKeys = await listDedupeCapShapeKeys(db);
		expect(new Set(shapeKeys)).toEqual(
			new Set(['example.com/a/{n}/', 'example.com/b/{n}/']),
		);
	});
});
