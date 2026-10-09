import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from '../libsql-dialect.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { listTransferColumns } from './list-transfer-columns.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'list-columns-source.sqlite');
const destFile = path.resolve(workingDir, 'list-columns-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('listTransferColumns', () => {
	it('returns column names for the main schema, in declaration order', async () => {
		const db = knex({
			client: LibsqlDialect as never,
			connection: { filename: destFile },
			useNullAsDefault: true,
		});
		await db.schema.createTable('t', (t) => {
			t.increments('id');
			t.string('b');
			t.string('a');
		});
		const columns = await listTransferColumns(db, 'main', 't');
		expect(columns).toEqual(['id', 'b', 'a']);
		await db.destroy();
	});

	it('excludes requested column names', async () => {
		const db = knex({
			client: LibsqlDialect as never,
			connection: { filename: destFile },
			useNullAsDefault: true,
		});
		await db.schema.createTable('t', (t) => {
			t.increments('id');
			t.string('v');
		});
		expect(await listTransferColumns(db, 'main', 't', ['id'])).toEqual(['v']);
		await db.destroy();
	});

	it('reads columns from an attached schema (not just main)', async () => {
		const source = knex({
			client: LibsqlDialect as never,
			connection: { filename: sourceFile },
			useNullAsDefault: true,
		});
		await source.schema.createTable('t', (t) => {
			t.increments('id');
			t.string('legacy_only_column');
		});
		await source.destroy();

		const dest = knex({
			client: LibsqlDialect as never,
			connection: { filename: destFile },
			useNullAsDefault: true,
		});
		const detach = await attachSourceDatabase(dest, sourceFile);
		try {
			const columns = await listTransferColumns(dest, TRANSFER_SOURCE_ALIAS, 't');
			expect(columns).toEqual(['id', 'legacy_only_column']);
		} finally {
			await detach();
		}
		await dest.destroy();
	});

	it('throws for a table that does not exist', async () => {
		const db = knex({
			client: LibsqlDialect as never,
			connection: { filename: destFile },
			useNullAsDefault: true,
		});
		await expect(listTransferColumns(db, 'main', 'nope')).rejects.toThrow(
			/No columns found/,
		);
		await db.destroy();
	});
});
