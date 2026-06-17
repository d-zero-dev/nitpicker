import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migratePagesResourcesSource } from './migrate-pages-resources-source.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const FIXTURES = [
	'migrate-source-both.sqlite',
	'migrate-source-idempotent.sqlite',
	'migrate-source-partial.sqlite',
	'migrate-source-empty.sqlite',
	'migrate-source-resources-only.sqlite',
	'migrate-source-pages-only.sqlite',
	'migrate-source-default-backfill.sqlite',
];

/**
 * Build a knex instance against a temp SQLite file that simulates a v0.10
 * archive predating the inventory feature: pages / resources tables exist
 * with their original column set but no `source` column.
 * @param fileName - Name of the SQLite file relative to workingDir.
 * @returns The connected knex instance and full file path.
 */
async function buildLegacySchema(fileName: string) {
	const filename = path.resolve(workingDir, fileName);
	await fs.rm(filename, { force: true });
	const instance = knex({
		client: LibsqlDialect as never,
		connection: { filename },
		useNullAsDefault: true,
	});
	await instance.schema.createTable('pages', (t) => {
		t.increments('id');
		t.string('url').notNullable().unique();
		t.boolean('scraped').notNullable().defaultTo(0);
		t.boolean('isTarget').notNullable().defaultTo(0);
	});
	await instance.schema.createTable('resources', (t) => {
		t.increments('id');
		t.string('url').notNullable().unique();
		t.integer('status');
	});
	return { instance, filename };
}

afterEach(async () => {
	for (const name of FIXTURES) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migratePagesResourcesSource', () => {
	it('adds source columns to both pages and resources and backfills existing rows with the default', async () => {
		const { instance } = await buildLegacySchema('migrate-source-both.sqlite');
		await instance('pages').insert({
			url: 'https://example.com/',
			scraped: 1,
			isTarget: 1,
		});
		await instance('resources').insert({ url: 'https://example.com/a.css', status: 200 });

		await migratePagesResourcesSource(instance);

		expect(await instance.schema.hasColumn('pages', 'source')).toBe(true);
		expect(await instance.schema.hasColumn('resources', 'source')).toBe(true);

		const [pageRow] = await instance.select('source').from('pages');
		const [resourceRow] = await instance.select('source').from('resources');
		expect(pageRow.source).toBe('crawled');
		expect(resourceRow.source).toBe('crawled');

		await instance.destroy();
	});

	it('is idempotent — calling twice on a migrated schema is a no-op', async () => {
		const { instance } = await buildLegacySchema('migrate-source-idempotent.sqlite');

		await migratePagesResourcesSource(instance);
		await migratePagesResourcesSource(instance);

		expect(await instance.schema.hasColumn('pages', 'source')).toBe(true);
		expect(await instance.schema.hasColumn('resources', 'source')).toBe(true);

		await instance.destroy();
	});

	it('handles partial migration recovery (pages.source already added, resources.source missing)', async () => {
		const { instance } = await buildLegacySchema('migrate-source-partial.sqlite');
		// Simulate a previous run that added pages.source but crashed before
		// touching resources.
		await instance.schema.table('pages', (t) => {
			t.string('source').notNullable().defaultTo('crawled');
		});

		await migratePagesResourcesSource(instance);

		expect(await instance.schema.hasColumn('pages', 'source')).toBe(true);
		expect(await instance.schema.hasColumn('resources', 'source')).toBe(true);

		await instance.destroy();
	});

	it('returns silently when neither pages nor resources table exists (fresh DB)', async () => {
		const filename = path.resolve(workingDir, 'migrate-source-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await expect(migratePagesResourcesSource(instance)).resolves.toBeUndefined();

		await instance.destroy();
	});

	it('runs migration on resources only when pages table is absent', async () => {
		const filename = path.resolve(workingDir, 'migrate-source-resources-only.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});
		await instance.schema.createTable('resources', (t) => {
			t.increments('id');
			t.string('url').notNullable().unique();
		});

		await migratePagesResourcesSource(instance);

		expect(await instance.schema.hasColumn('resources', 'source')).toBe(true);
		expect(await instance.schema.hasTable('pages')).toBe(false);

		await instance.destroy();
	});

	it('runs migration on pages only when resources table is absent (symmetric case)', async () => {
		const filename = path.resolve(workingDir, 'migrate-source-pages-only.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});
		await instance.schema.createTable('pages', (t) => {
			t.increments('id');
			t.string('url').notNullable().unique();
			t.boolean('scraped').notNullable().defaultTo(0);
			t.boolean('isTarget').notNullable().defaultTo(0);
		});

		await migratePagesResourcesSource(instance);

		expect(await instance.schema.hasColumn('pages', 'source')).toBe(true);
		expect(await instance.schema.hasTable('resources')).toBe(false);

		await instance.destroy();
	});

	it('lets DEFAULT crawled fill in for INSERTs that omit the source column', async () => {
		const { instance } = await buildLegacySchema(
			'migrate-source-default-backfill.sqlite',
		);

		await migratePagesResourcesSource(instance);

		// INSERT after migration without specifying source — DEFAULT must apply.
		await instance('pages').insert({
			url: 'https://example.com/post-migrate',
			scraped: 1,
			isTarget: 0,
		});
		const [pageRow] = await instance
			.select('source')
			.from('pages')
			.where('url', 'https://example.com/post-migrate');
		expect(pageRow.source).toBe('crawled');

		await instance.destroy();
	});
});
