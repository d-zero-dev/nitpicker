import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migratePageMetaCustomElementCount } from './migrate-page-meta-custom-element-count.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file that simulates an archive
 * predating this feature: `page_meta` exists (keyed by `page_id`) but has no
 * `main_content_custom_element_count` column.
 * @param fileName - Name of the SQLite file relative to workingDir.
 * @returns The connected knex instance.
 */
async function buildLegacyPageMeta(fileName: string) {
	const filename = path.resolve(workingDir, fileName);
	await fs.rm(filename, { force: true });
	const instance = knex({
		client: LibsqlDialect as never,
		connection: { filename },
		useNullAsDefault: true,
	});
	await instance.schema.createTable('page_meta', (t) => {
		t.integer('page_id').primary();
		t.string('lang');
	});
	return { instance, filename };
}

afterEach(async () => {
	for (const name of [
		'migrate-custom-element-count-test.sqlite',
		'migrate-custom-element-count-idempotent.sqlite',
		'migrate-custom-element-count-empty.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migratePageMetaCustomElementCount', () => {
	it('adds the main_content_custom_element_count column to an existing page_meta', async () => {
		const { instance } = await buildLegacyPageMeta(
			'migrate-custom-element-count-test.sqlite',
		);
		await instance('page_meta').insert({ page_id: 1, lang: 'ja' });

		await migratePageMetaCustomElementCount(instance);

		expect(
			await instance.schema.hasColumn('page_meta', 'main_content_custom_element_count'),
		).toBe(true);

		// Pre-existing row and columns survive untouched, new column is NULL.
		const [row] = await instance
			.select('lang', 'main_content_custom_element_count')
			.from('page_meta');
		expect(row.lang).toBe('ja');
		expect(row.main_content_custom_element_count).toBeNull();

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyPageMeta(
			'migrate-custom-element-count-idempotent.sqlite',
		);

		await migratePageMetaCustomElementCount(instance);
		await expect(migratePageMetaCustomElementCount(instance)).resolves.toBeUndefined();

		expect(
			await instance.schema.hasColumn('page_meta', 'main_content_custom_element_count'),
		).toBe(true);

		await instance.destroy();
	});

	it('returns silently when page_meta does not exist', async () => {
		const filename = path.resolve(
			workingDir,
			'migrate-custom-element-count-empty.sqlite',
		);
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await expect(migratePageMetaCustomElementCount(instance)).resolves.toBeUndefined();

		await instance.destroy();
	});
});
