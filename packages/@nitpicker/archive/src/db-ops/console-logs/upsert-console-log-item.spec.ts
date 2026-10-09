import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';
import { createWriteRefCaches } from '../_shared/create-write-ref-caches.js';

import { upsertConsoleLogItem } from './upsert-console-log-item.js';

describe('upsertConsoleLogItem', () => {
	let db: Knex;
	let textId: number;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
		await createAdjunctTables(db);
		const [row] = await db('text_refs')
			.insert({ hash: Buffer.from('t'), text: 'boom' })
			.returning('id');
		textId = (row as { id: number }).id;
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('inserts a fresh row for a hash seen for the first time', async () => {
		const caches = createWriteRefCaches();
		const id = await upsertConsoleLogItem(db, caches, {
			hash: Buffer.from('hash-a'),
			type: 'error',
			textId,
			argsJsonId: null,
			locUrlId: null,
			locLine: null,
			locColumn: null,
			stackTextId: null,
		});
		const rows = await db('console_log_items').select('id', 'type');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(id);
		expect(rows[0]?.type).toBe('error');
	});

	it('returns the existing id on a repeat hash without inserting a second row', async () => {
		const caches = createWriteRefCaches();
		const hash = Buffer.from('hash-b');
		const first = await upsertConsoleLogItem(db, caches, {
			hash,
			type: 'warn',
			textId,
			argsJsonId: null,
			locUrlId: null,
			locLine: null,
			locColumn: null,
			stackTextId: null,
		});
		const second = await upsertConsoleLogItem(db, caches, {
			hash,
			type: 'warn',
			textId,
			argsJsonId: null,
			locUrlId: null,
			locLine: null,
			locColumn: null,
			stackTextId: null,
		});
		expect(second).toBe(first);
		const rows = await db('console_log_items').select('id');
		expect(rows).toHaveLength(1);
	});

	it('populates the cache after resolving a hash', async () => {
		const caches = createWriteRefCaches();
		const hash = Buffer.from('hash-c');
		const id = await upsertConsoleLogItem(db, caches, {
			hash,
			type: 'log',
			textId,
			argsJsonId: null,
			locUrlId: null,
			locLine: null,
			locColumn: null,
			stackTextId: null,
		});
		expect(caches.consoleLogIds.get(hash.toString('hex'))).toBe(id);
	});
});
