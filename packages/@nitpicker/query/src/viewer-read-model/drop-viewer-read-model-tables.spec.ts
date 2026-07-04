import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createViewerReadModelTables } from './create-viewer-read-model-tables.js';
import { dropViewerReadModelTables } from './drop-viewer-read-model-tables.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_drop_viewer_read_model_tables__',
);

describe('dropViewerReadModelTables', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'drop-tables-test.nitpicker');

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

	it('is a no-op when the tables were never created', async () => {
		await expect(
			archive.getKnex().transaction((trx) => dropViewerReadModelTables(trx)),
		).resolves.toBeUndefined();
	});

	it('drops all 10 tables after they were created', async () => {
		const knex = archive.getKnex();
		await knex.transaction((trx) => createViewerReadModelTables(trx));
		for (const table of [
			'viewer_read_model_meta',
			'viewer_summary',
			'viewer_pages',
			'viewer_query_profiles',
			'viewer_count_buckets',
			'viewer_page_anchors',
			'viewer_directory_nodes',
			'viewer_directory_pages',
			'viewer_external_links',
			'viewer_anchor_facts',
		]) {
			expect(await knex.schema.hasTable(table)).toBe(true);
		}

		await knex.transaction((trx) => dropViewerReadModelTables(trx));
		for (const table of [
			'viewer_read_model_meta',
			'viewer_summary',
			'viewer_pages',
			'viewer_query_profiles',
			'viewer_count_buckets',
			'viewer_page_anchors',
			'viewer_directory_nodes',
			'viewer_directory_pages',
			'viewer_external_links',
			'viewer_anchor_facts',
		]) {
			expect(await knex.schema.hasTable(table)).toBe(false);
		}
	});
});
