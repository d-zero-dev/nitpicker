import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createViewerReadModelTables } from './create-viewer-read-model-tables.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_create_viewer_read_model_tables__',
);

describe('createViewerReadModelTables', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'create-tables-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('creates all 5 tables and the 5 named viewer_pages indexes', async () => {
		const knex = archive.getKnex();
		await knex.transaction((trx) => createViewerReadModelTables(trx));

		for (const table of [
			'viewer_read_model_meta',
			'viewer_pages',
			'viewer_query_profiles',
			'viewer_count_buckets',
			'viewer_page_anchors',
		]) {
			expect(await knex.schema.hasTable(table)).toBe(true);
		}

		const indexRows: Array<{ name: string }> = await knex('sqlite_master')
			.where({ type: 'index', tbl_name: 'viewer_pages' })
			.select('name');
		const indexNames = new Set(indexRows.map((r) => r.name));
		for (const indexName of [
			'vp_default',
			'vp_status',
			'vp_title',
			'vp_missing_title',
			'vp_noindex',
		]) {
			expect(indexNames.has(indexName)).toBe(true);
		}
	});

	it('viewer_query_profiles enforces a composite (scope, profile_key) key, not a single-column rowid', async () => {
		const knex = archive.getKnex();
		await knex('viewer_query_profiles').insert([
			{
				scope: 'pages',
				profile_key: 'a',
				sort_key: 'url_sort_key',
				sort_order: 'asc',
				total: 1,
			},
			{
				scope: 'pages',
				profile_key: 'b',
				sort_key: 'url_sort_key',
				sort_order: 'asc',
				total: 2,
			},
		]);
		const rows = await knex('viewer_query_profiles')
			.select('profile_key')
			.orderBy('profile_key');
		expect(rows.map((r) => r.profile_key)).toEqual(['a', 'b']);
	});
});
