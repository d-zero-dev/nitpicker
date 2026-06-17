import type { Knex } from 'knex';

import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from '../libsql-dialect.js';

import { assertCompatibleVersion } from './assert-compatible-version.js';
import { IncompatibleArchiveError } from './types.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const connections: Array<{ db: Knex; filename: string }> = [];

/**
 * Builds a knex instance backed by a temp SQLite file for each test.
 * @param name - Test-unique name (used as the SQLite file basename).
 */
async function makeDb(name: string): Promise<Knex> {
	await fs.mkdir(workingDir, { recursive: true });
	const filename = path.resolve(workingDir, `${name}.sqlite`);
	await fs.rm(filename, { force: true });
	const db = knex({
		client: LibsqlDialect as never,
		connection: { filename },
		useNullAsDefault: true,
	});
	connections.push({ db, filename });
	return db;
}

afterEach(async () => {
	while (connections.length > 0) {
		const { db, filename } = connections.pop()!;
		await db.destroy();
		await fs.rm(filename, { force: true });
	}
});

describe('assertCompatibleVersion', () => {
	it('returns immediately when the info table does not exist (new archive)', async () => {
		const db = await makeDb('assert-version-empty');
		await expect(assertCompatibleVersion(db)).resolves.toBeUndefined();
	});

	it('returns when info exists but pages does not (corrupted partial archive)', async () => {
		const db = await makeDb('assert-version-no-pages');
		await db.schema.createTable('info', (t) => {
			t.increments('id');
			t.string('version');
		});
		await db('info').insert({ version: '0.5.0' });
		await expect(assertCompatibleVersion(db)).resolves.toBeUndefined();
	});

	it('throws IncompatibleArchiveError when pages.meta_extras is missing (v1)', async () => {
		const db = await makeDb('assert-version-legacy');
		await db.schema.createTable('info', (t) => {
			t.increments('id');
			t.string('version');
		});
		await db('info').insert({ version: '0.9.0' });
		await db.schema.createTable('pages', (t) => {
			t.increments('id');
			t.string('og_type');
		});
		await expect(assertCompatibleVersion(db)).rejects.toThrow(IncompatibleArchiveError);
	});

	it('includes the archive version in the thrown error', async () => {
		const db = await makeDb('assert-version-message');
		await db.schema.createTable('info', (t) => {
			t.increments('id');
			t.string('version');
		});
		await db('info').insert({ version: '0.9.0' });
		await db.schema.createTable('pages', (t) => {
			t.increments('id');
		});
		try {
			await assertCompatibleVersion(db);
			throw new Error('Expected throw');
		} catch (error) {
			expect(error).toBeInstanceOf(IncompatibleArchiveError);
			expect((error as IncompatibleArchiveError).archiveVersion).toBe('0.9.0');
		}
	});

	it('returns silently when pages.meta_extras exists (v2 or later)', async () => {
		const db = await makeDb('assert-version-current');
		await db.schema.createTable('info', (t) => {
			t.increments('id');
			t.string('version');
		});
		await db('info').insert({ version: '0.10.0' });
		await db.schema.createTable('pages', (t) => {
			t.increments('id');
			t.json('meta_extras');
		});
		await expect(assertCompatibleVersion(db)).resolves.toBeUndefined();
	});
});
