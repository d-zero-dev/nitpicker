import knex from 'knex';
import libsql from 'libsql';
import { describe, it, expect } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';

describe('LibsqlDialect', () => {
	it('Knex の better-sqlite3 dialect の driverName を継承する', () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		expect(db.client.driverName).toBe('better-sqlite3');
		return db.destroy();
	});

	it('_driver() が libsql コンストラクタを返す', () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		expect(db.client._driver()).toBe(libsql);
		return db.destroy();
	});

	it('libsql バイナリで実 SQL を実行できる', async () => {
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await db.schema.createTable('t', (t) => {
			t.increments('id');
			t.string('name');
		});
		await db('t').insert({ name: 'a' });
		const rows = await db('t').select('*');
		expect(rows).toEqual([{ id: 1, name: 'a' }]);
		await db.destroy();
	});
});
