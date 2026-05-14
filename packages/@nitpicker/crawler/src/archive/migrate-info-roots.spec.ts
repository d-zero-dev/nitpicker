import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migrateInfoRoots } from './migrate-info-roots.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file that simulates a v0.x
 * archive predating the multi-root feature: the `info` table exists, has
 * `baseUrl` and `scope` columns, but no `roots` column.
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
		t.string('baseUrl');
		t.json('scope');
	});
	return { instance, filename };
}

afterEach(async () => {
	for (const name of [
		'migrate-test.sqlite',
		'migrate-null.sqlite',
		'migrate-idempotent.sqlite',
		'migrate-empty.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migrateInfoRoots', () => {
	it('adds the roots column and seeds it from baseUrl on legacy archives', async () => {
		const { instance } = await buildLegacyInfo('migrate-test.sqlite');
		await instance('info').insert({ baseUrl: 'https://example.com/blog/' });

		await migrateInfoRoots(instance);

		const hasRoots = await instance.schema.hasColumn('info', 'roots');
		expect(hasRoots).toBe(true);

		const [row] = await instance.select('roots').from('info');
		expect(JSON.parse(row.roots as string)).toEqual(['https://example.com/blog/']);

		await instance.destroy();
	});

	it('seeds roots as [] when baseUrl is NULL', async () => {
		const { instance } = await buildLegacyInfo('migrate-null.sqlite');
		await instance('info').insert({ baseUrl: null });

		await migrateInfoRoots(instance);

		const [row] = await instance.select('roots').from('info');
		expect(JSON.parse(row.roots as string)).toEqual([]);

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyInfo('migrate-idempotent.sqlite');
		await instance('info').insert({ baseUrl: 'https://example.com/' });

		await migrateInfoRoots(instance);
		// 2 度目: column が既にあるので ALTER も UPDATE も走らない
		await migrateInfoRoots(instance);

		const [row] = await instance.select('roots').from('info');
		expect(JSON.parse(row.roots as string)).toEqual(['https://example.com/']);

		await instance.destroy();
	});

	it('returns silently when the info table does not exist (fresh DB)', async () => {
		const filename = path.resolve(workingDir, 'migrate-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		// migration should not throw, just skip
		await expect(migrateInfoRoots(instance)).resolves.toBeUndefined();

		await instance.destroy();
	});
});
