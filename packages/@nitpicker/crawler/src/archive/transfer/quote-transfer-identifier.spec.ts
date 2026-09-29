import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, it, expect } from 'vitest';

import { LibsqlDialect } from '../libsql-dialect.js';

import { quoteTransferIdentifier } from './quote-transfer-identifier.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');
const filename = path.resolve(workingDir, 'quote-transfer-identifier-test.sqlite');

afterEach(async () => {
	await fs.rm(filename, { force: true });
});

describe('quoteTransferIdentifier', () => {
	it('quotes a bare identifier', () => {
		expect(quoteTransferIdentifier('id')).toBe('"id"');
	});

	it('quotes a reserved-word column name (the exact case this function exists for)', () => {
		expect(quoteTransferIdentifier('order')).toBe('"order"');
	});

	it('escapes an embedded double quote by doubling it', () => {
		expect(quoteTransferIdentifier('a"b')).toBe('"a""b"');
	});

	it('escapes multiple embedded double quotes', () => {
		expect(quoteTransferIdentifier('"weird"')).toBe('"""weird"""');
	});

	it('lets a reserved-word column actually be referenced in a real SQL statement (the regression this function prevents)', async () => {
		const db = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});
		// `order` is a bare identifier here — libsql/knex's own quoting on
		// `t.integer('order')` handles table creation, so this test only
		// needs to prove a raw SQL SELECT built the way this codebase's
		// generic column-list builders do (interpolating a bare name) would
		// fail without quoting, and succeeds with it.
		await db.schema.createTable('t', (t) => {
			t.increments('id');
			t.integer('order');
		});
		await db('t').insert({ order: 5 });

		await expect(
			db.raw(`SELECT ${quoteTransferIdentifier('order')} FROM t`),
		).resolves.toEqual([{ order: 5 }]);
		await expect(db.raw('SELECT order FROM t')).rejects.toThrow();

		await db.destroy();
	});
});
