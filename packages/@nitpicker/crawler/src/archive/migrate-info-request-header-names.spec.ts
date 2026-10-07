import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migrateInfoRequestHeaderNames } from './migrate-info-request-header-names.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file that simulates an archive
 * predating this feature: `info` exists but has no `requestHeaderNames`
 * column.
 * @param fileName - Name of the SQLite file relative to workingDir.
 * @returns The connected knex instance.
 */
async function buildLegacyInfo(fileName: string) {
	const filename = path.resolve(workingDir, fileName);
	await fs.rm(filename, { force: true });
	const instance = knex({
		client: LibsqlDialect as never,
		connection: { filename },
		useNullAsDefault: true,
	});
	await instance.schema.createTable('info', (t) => {
		t.increments('id');
		t.string('userAgent');
	});
	return { instance, filename };
}

afterEach(async () => {
	for (const name of [
		'migrate-test.sqlite',
		'migrate-idempotent.sqlite',
		'migrate-empty.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migrateInfoRequestHeaderNames', () => {
	it('adds the requestHeaderNames column to an existing info table', async () => {
		const { instance } = await buildLegacyInfo('migrate-test.sqlite');
		await instance('info').insert({ userAgent: 'test' });

		await migrateInfoRequestHeaderNames(instance);

		expect(await instance.schema.hasColumn('info', 'requestHeaderNames')).toBe(true);

		// Pre-existing row and columns survive untouched, new column is NULL.
		const [row] = await instance.select('userAgent', 'requestHeaderNames').from('info');
		expect(row.userAgent).toBe('test');
		expect(row.requestHeaderNames).toBeNull();

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyInfo('migrate-idempotent.sqlite');

		await migrateInfoRequestHeaderNames(instance);
		await expect(migrateInfoRequestHeaderNames(instance)).resolves.toBeUndefined();

		expect(await instance.schema.hasColumn('info', 'requestHeaderNames')).toBe(true);

		await instance.destroy();
	});

	it('returns silently when info does not exist', async () => {
		const filename = path.resolve(workingDir, 'migrate-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await expect(migrateInfoRequestHeaderNames(instance)).resolves.toBeUndefined();

		await instance.destroy();
	});
});
