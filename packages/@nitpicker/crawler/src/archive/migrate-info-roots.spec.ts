import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { Database } from './database.js';
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
		'migrate-mixed.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migrateInfoRoots', () => {
	it('adds roots, seeds it from baseUrl, and drops the obsolete scope column', async () => {
		const { instance } = await buildLegacyInfo('migrate-test.sqlite');
		await instance('info').insert({ baseUrl: 'https://example.com/blog/' });

		await migrateInfoRoots(instance);

		const hasRoots = await instance.schema.hasColumn('info', 'roots');
		expect(hasRoots).toBe(true);
		const hasScope = await instance.schema.hasColumn('info', 'scope');
		expect(hasScope).toBe(false);

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
		expect(await instance.schema.hasColumn('info', 'scope')).toBe(false);

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyInfo('migrate-idempotent.sqlite');
		await instance('info').insert({ baseUrl: 'https://example.com/' });

		await migrateInfoRoots(instance);
		// 1 回目で scope は drop され roots が seed される
		expect(await instance.schema.hasColumn('info', 'scope')).toBe(false);
		expect(await instance.schema.hasColumn('info', 'roots')).toBe(true);

		// 2 度目: hasRoots && !hasScope の早期 return で何も走らない
		await migrateInfoRoots(instance);
		expect(await instance.schema.hasColumn('info', 'scope')).toBe(false);

		const [row] = await instance.select('roots').from('info');
		expect(JSON.parse(row.roots as string)).toEqual(['https://example.com/']);

		await instance.destroy();
	});

	it('drops scope on archives that already have roots (partial-migration recovery)', async () => {
		// 過去の migration が roots 追加だけで止まった archive、または手動で
		// roots だけ生やした archive を想定。両カラムが同時に存在する状態。
		const filename = path.resolve(workingDir, 'migrate-mixed.sqlite');
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
			t.json('roots');
		});
		await instance('info').insert({
			baseUrl: 'https://example.com',
			scope: '[]',
			roots: JSON.stringify(['https://example.com']),
		});

		await migrateInfoRoots(instance);

		expect(await instance.schema.hasColumn('info', 'scope')).toBe(false);
		expect(await instance.schema.hasColumn('info', 'roots')).toBe(true);
		const [row] = await instance.select('roots').from('info');
		expect(JSON.parse(row.roots as string)).toEqual(['https://example.com']);

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

	it('Database.connect で legacy archive を開くと migration が自動実行され getConfig().roots に baseUrl が seed される', async () => {
		// 1) legacy schema (roots 列無し) の archive を直接作る
		const filename = path.resolve(workingDir, 'migrate-via-connect.sqlite');
		await fs.rm(filename, { force: true });
		const legacy = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});
		await legacy.schema.createTable('info', (t) => {
			t.increments('id');
			t.string('version');
			t.string('name');
			t.string('baseUrl');
			t.boolean('recursive');
			t.integer('interval');
			t.boolean('image');
			t.boolean('fetchExternal');
			t.integer('parallels');
			t.json('scope');
			t.json('excludes');
			t.json('excludeKeywords');
			t.json('excludeUrls');
			t.integer('maxExcludedDepth');
			t.integer('retry');
			t.boolean('fromList');
			t.boolean('disableQueries');
			t.string('userAgent');
			t.boolean('ignoreRobots');
		});
		await legacy('info').insert({
			version: '0.5.0',
			name: 'legacy',
			baseUrl: 'https://legacy.example.com',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			scope: '[]',
			excludes: '[]',
			excludeKeywords: '[]',
			excludeUrls: '[]',
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'legacy',
			ignoreRobots: false,
		});
		await legacy.destroy();

		// 2) Database.connect 経由で開く → #init() が migrateInfoRoots を呼ぶ
		const db = await Database.connect({
			workingDir,
			filename,
		});
		const config = await db.getConfig();

		// 3) roots カラムは追加され、baseUrl で seed されている
		expect(config.roots).toEqual(['https://legacy.example.com']);

		// 4) scope カラムは drop されている
		const knexInstance = db.getKnex();
		expect(await knexInstance.schema.hasColumn('info', 'scope')).toBe(false);

		await db.destroy();
		await fs.rm(filename, { force: true });
	});
});
