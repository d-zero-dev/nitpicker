import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from '../libsql-dialect.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'attach-source.sqlite');
const destFile = path.resolve(workingDir, 'attach-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
	await fs.rm(path.resolve(workingDir, 'does-not-exist.sqlite'), { force: true });
});

describe('attachSourceDatabase', () => {
	it('attaches the source under the fixed alias and reads across it', async () => {
		const source = knex({
			client: LibsqlDialect as never,
			connection: { filename: sourceFile },
			useNullAsDefault: true,
		});
		await source.schema.createTable('t', (t) => {
			t.increments('id');
			t.string('v');
		});
		await source('t').insert({ v: 'hello' });
		await source.destroy();

		const dest = knex({
			client: LibsqlDialect as never,
			connection: { filename: destFile },
			useNullAsDefault: true,
		});
		const detach = await attachSourceDatabase(dest, sourceFile);
		try {
			const rows = await dest(`${TRANSFER_SOURCE_ALIAS}.t`).select('v');
			expect(rows).toEqual([{ v: 'hello' }]);
		} finally {
			await detach();
		}

		// Detach actually released the alias — a second attach must not
		// collide with a still-open one.
		await expect(attachSourceDatabase(dest, sourceFile)).resolves.toBeInstanceOf(
			Function,
		);
		await dest.raw(`DETACH DATABASE ${TRANSFER_SOURCE_ALIAS}`);
		await dest.destroy();
	});

	it('reading a table absent from a freshly-attached (non-existent-path) source throws', async () => {
		// SQLite's ATTACH lazily creates the file on first access rather than
		// erroring immediately — so attaching a not-yet-existent path
		// succeeds, but the attached DB is genuinely empty, which is what
		// matters: a caller cannot silently read stale/wrong data through it.
		const dest = knex({
			client: LibsqlDialect as never,
			connection: { filename: destFile },
			useNullAsDefault: true,
		});
		const detach = await attachSourceDatabase(
			dest,
			path.resolve(workingDir, 'does-not-exist.sqlite'),
		);
		await expect(
			dest(`${TRANSFER_SOURCE_ALIAS}.content_items`).select('*'),
		).rejects.toThrow();
		await detach();
		await dest.destroy();
	});

	it('detach is a no-op-safe callable even if called twice', async () => {
		const source = knex({
			client: LibsqlDialect as never,
			connection: { filename: sourceFile },
			useNullAsDefault: true,
		});
		await source.schema.createTable('t', (t) => {
			t.increments('id');
		});
		await source.destroy();

		const dest = knex({
			client: LibsqlDialect as never,
			connection: { filename: destFile },
			useNullAsDefault: true,
		});
		const detach = await attachSourceDatabase(dest, sourceFile);
		await detach();
		await expect(detach()).resolves.toBeUndefined();
		await dest.destroy();
	});
});
