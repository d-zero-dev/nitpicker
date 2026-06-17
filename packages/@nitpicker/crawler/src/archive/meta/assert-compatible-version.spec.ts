import type { Knex } from 'knex';

import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from '../libsql-dialect.js';

import {
	assertCompatibleVersion,
	REQUIRED_FORMAT_VERSION,
} from './assert-compatible-version.js';
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

/**
 * Seeds the `info` table with a single row carrying the given version
 * string. Mirrors what `setConfig` writes at archive create time.
 * @param db
 * @param version
 */
async function seedInfoVersion(db: Knex, version: string | null): Promise<void> {
	await db.schema.createTable('info', (t) => {
		t.increments('id');
		t.string('version');
	});
	await db('info').insert({ version });
}

afterEach(async () => {
	while (connections.length > 0) {
		const { db, filename } = connections.pop()!;
		await db.destroy();
		await fs.rm(filename, { force: true });
	}
});

describe('assertCompatibleVersion', () => {
	it('returns silently when the info table does not exist (new archive)', async () => {
		const db = await makeDb('assert-version-empty');
		await expect(assertCompatibleVersion(db)).resolves.toBeUndefined();
	});

	it('accepts an archive whose info.version equals REQUIRED_FORMAT_VERSION', async () => {
		const db = await makeDb('assert-version-eq');
		await seedInfoVersion(db, REQUIRED_FORMAT_VERSION);
		await expect(assertCompatibleVersion(db)).resolves.toBeUndefined();
	});

	it('accepts an archive whose info.version is newer than REQUIRED_FORMAT_VERSION', async () => {
		const db = await makeDb('assert-version-newer');
		await seedInfoVersion(db, '0.11.0');
		await expect(assertCompatibleVersion(db)).resolves.toBeUndefined();
	});

	it('throws IncompatibleArchiveError when info.version is older', async () => {
		const db = await makeDb('assert-version-older');
		await seedInfoVersion(db, '0.9.0');
		await expect(assertCompatibleVersion(db)).rejects.toThrow(IncompatibleArchiveError);
	});

	it('exposes archiveVersion and requiredVersion on the thrown error', async () => {
		const db = await makeDb('assert-version-error-fields');
		await seedInfoVersion(db, '0.9.0');
		try {
			await assertCompatibleVersion(db);
			throw new Error('Expected throw');
		} catch (error) {
			expect(error).toBeInstanceOf(IncompatibleArchiveError);
			expect((error as IncompatibleArchiveError).archiveVersion).toBe('0.9.0');
			expect((error as IncompatibleArchiveError).requiredVersion).toBe(
				REQUIRED_FORMAT_VERSION,
			);
		}
	});

	it('throws when info.version is null (treated as unknown)', async () => {
		const db = await makeDb('assert-version-null');
		await seedInfoVersion(db, null);
		try {
			await assertCompatibleVersion(db);
			throw new Error('Expected throw');
		} catch (error) {
			expect(error).toBeInstanceOf(IncompatibleArchiveError);
			expect((error as IncompatibleArchiveError).archiveVersion).toBe('unknown');
		}
	});

	it('throws when info.version is the empty string', async () => {
		const db = await makeDb('assert-version-empty-string');
		await seedInfoVersion(db, '');
		await expect(assertCompatibleVersion(db)).rejects.toThrow(IncompatibleArchiveError);
	});

	it('throws when info table exists but has no version column (pre-version-tracked archive)', async () => {
		const db = await makeDb('assert-version-no-column');
		await db.schema.createTable('info', (t) => {
			t.increments('id');
			t.string('name');
		});
		await db('info').insert({ name: 'pre-version-archive' });
		try {
			await assertCompatibleVersion(db);
			throw new Error('Expected throw');
		} catch (error) {
			expect(error).toBeInstanceOf(IncompatibleArchiveError);
			expect((error as IncompatibleArchiveError).archiveVersion).toBe('unknown');
		}
	});

	it('returns silently when info table exists with version column but zero rows (Archive.create transient state)', async () => {
		const db = await makeDb('assert-version-empty-table');
		await db.schema.createTable('info', (t) => {
			t.increments('id');
			t.string('version');
		});
		await expect(assertCompatibleVersion(db)).resolves.toBeUndefined();
	});
});
