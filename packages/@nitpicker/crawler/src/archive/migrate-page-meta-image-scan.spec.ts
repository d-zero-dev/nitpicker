import fs from 'node:fs/promises';
import path from 'node:path';

import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { LibsqlDialect } from './libsql-dialect.js';
import { migratePageMetaImageScan } from './migrate-page-meta-image-scan.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Build a knex instance against a temp SQLite file that simulates an archive
 * predating this feature: `page_meta` exists (keyed by `page_id`) but has no
 * `image_scan_desktop` / `image_scan_mobile` columns.
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
		'migrate-image-scan-test.sqlite',
		'migrate-image-scan-partial.sqlite',
		'migrate-image-scan-idempotent.sqlite',
		'migrate-image-scan-empty.sqlite',
	]) {
		await fs.rm(path.resolve(workingDir, name), { force: true });
	}
});

describe('migratePageMetaImageScan', () => {
	it('adds both image_scan_desktop and image_scan_mobile columns to an existing page_meta', async () => {
		const { instance } = await buildLegacyPageMeta('migrate-image-scan-test.sqlite');
		await instance('page_meta').insert({ page_id: 1, lang: 'ja' });

		await migratePageMetaImageScan(instance);

		expect(await instance.schema.hasColumn('page_meta', 'image_scan_desktop')).toBe(true);
		expect(await instance.schema.hasColumn('page_meta', 'image_scan_mobile')).toBe(true);

		// Pre-existing row and columns survive untouched, new columns are NULL.
		const [row] = await instance
			.select('lang', 'image_scan_desktop', 'image_scan_mobile')
			.from('page_meta');
		expect(row.lang).toBe('ja');
		expect(row.image_scan_desktop).toBeNull();
		expect(row.image_scan_mobile).toBeNull();

		await instance.destroy();
	});

	it('adds only the missing column when one already exists', async () => {
		const { instance } = await buildLegacyPageMeta('migrate-image-scan-partial.sqlite');
		await instance.schema.table('page_meta', (t) => {
			t.integer('image_scan_desktop');
		});
		await instance('page_meta').insert({ page_id: 1, image_scan_desktop: 0 });

		await migratePageMetaImageScan(instance);

		expect(await instance.schema.hasColumn('page_meta', 'image_scan_mobile')).toBe(true);
		const [row] = await instance
			.select('image_scan_desktop', 'image_scan_mobile')
			.from('page_meta');
		// Pre-existing value in the already-present column is untouched.
		expect(row.image_scan_desktop).toBe(0);
		expect(row.image_scan_mobile).toBeNull();

		await instance.destroy();
	});

	it('is idempotent — calling twice on an up-to-date schema is a no-op', async () => {
		const { instance } = await buildLegacyPageMeta(
			'migrate-image-scan-idempotent.sqlite',
		);

		await migratePageMetaImageScan(instance);
		await expect(migratePageMetaImageScan(instance)).resolves.toBeUndefined();

		expect(await instance.schema.hasColumn('page_meta', 'image_scan_desktop')).toBe(true);
		expect(await instance.schema.hasColumn('page_meta', 'image_scan_mobile')).toBe(true);

		await instance.destroy();
	});

	it('returns silently when page_meta does not exist', async () => {
		const filename = path.resolve(workingDir, 'migrate-image-scan-empty.sqlite');
		await fs.rm(filename, { force: true });
		const instance = knex({
			client: LibsqlDialect as never,
			connection: { filename },
			useNullAsDefault: true,
		});

		await expect(migratePageMetaImageScan(instance)).resolves.toBeUndefined();

		await instance.destroy();
	});
});
