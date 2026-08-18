import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createViewerReadModelIndexes } from './create-viewer-read-model-indexes.js';
import { createViewerReadModelTables } from './create-viewer-read-model-tables.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_create_viewer_read_model_indexes__',
);

describe('createViewerReadModelIndexes', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'create-indexes-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.getKnex().transaction(async (trx) => {
			await createViewerReadModelTables(trx);
			await createViewerReadModelIndexes(trx);
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	/**
	 * Reads back the set of index names on a table via `sqlite_master`.
	 * @param table - The table to inspect.
	 * @returns The set of index names defined on that table.
	 */
	async function indexNamesOn(table: string): Promise<Set<string>> {
		const knex = archive.getKnex();
		const rows: { name: string }[] = await knex('sqlite_master')
			.where({ type: 'index', tbl_name: table })
			.select('name');
		return new Set(rows.map((row) => row.name));
	}

	it('creates every viewer_pages index', async () => {
		const indexNames = await indexNamesOn('viewer_pages');
		for (const indexName of [
			'vp_default',
			'vp_status',
			'vp_status_desc',
			'vp_title',
			'vp_missing_title',
			'vp_missing_description',
			'vp_noindex',
			'vp_source',
			'vp_path',
		]) {
			expect(indexNames.has(indexName)).toBe(true);
		}
	});

	it('creates every viewer_directory_nodes and viewer_directory_pages index', async () => {
		const nodeIndexNames = await indexNamesOn('viewer_directory_nodes');
		expect(nodeIndexNames.has('vdn_path_depth')).toBe(true);
		expect(nodeIndexNames.has('vdn_parent_name')).toBe(true);

		const pageIndexNames = await indexNamesOn('viewer_directory_pages');
		expect(pageIndexNames.has('vdp_node_url')).toBe(true);
	});

	it('creates every viewer_external_links index', async () => {
		const indexNames = await indexNamesOn('viewer_external_links');
		for (const indexName of ['vel_url', 'vel_status', 'vel_referrer_count']) {
			expect(indexNames.has(indexName)).toBe(true);
		}
	});

	it('does not add a duplicate viewer_url_refs URL index', async () => {
		const indexNames = await indexNamesOn('viewer_url_refs');
		expect(indexNames.has('vur_url')).toBe(false);
	});

	it('creates every viewer_anchor_facts index', async () => {
		const indexNames = await indexNamesOn('viewer_anchor_facts');
		for (const indexName of [
			'vaf_broken_source',
			'vaf_broken_dest',
			'vaf_broken_status',
			'vaf_broken_status_desc',
			'vaf_source',
			'vaf_dest',
		]) {
			expect(indexNames.has(indexName)).toBe(true);
		}
	});

	it('creates the viewer_error_kind_entries count index', async () => {
		const indexNames = await indexNamesOn('viewer_error_kind_entries');
		expect(indexNames.has('vee_count')).toBe(true);
	});

	it('creates every viewer_resources index', async () => {
		const indexNames = await indexNamesOn('viewer_resources');
		for (const indexName of [
			'vr_default',
			'vr_url_order',
			'vr_status',
			'vr_status_desc',
			'vr_status_order',
			'vr_status_desc_order',
			'vr_unused',
			'vr_unused_status',
			'vr_unused_status_desc',
			'vr_unused_source',
		]) {
			expect(indexNames.has(indexName)).toBe(true);
		}
	});

	it('creates every viewer_images index', async () => {
		const indexNames = await indexNamesOn('viewer_images');
		for (const indexName of [
			'vi_default',
			'vi_missing_alt',
			'vi_missing_dimensions',
			'vi_width',
			'vi_height',
			'vi_natural_width',
			'vi_natural_height',
			'vi_is_lazy',
		]) {
			expect(indexNames.has(indexName)).toBe(true);
		}
	});

	it('creates every viewer_header_checks index', async () => {
		const indexNames = await indexNamesOn('viewer_header_checks');
		for (const indexName of ['vh_missing', 'vh_default']) {
			expect(indexNames.has(indexName)).toBe(true);
		}
	});

	it('creates the viewer_duplicate_groups field/count index', async () => {
		const indexNames = await indexNamesOn('viewer_duplicate_groups');
		expect(indexNames.has('vdg_field_count')).toBe(true);
	});

	it('creates the viewer_duplicate_group_pages group/url index', async () => {
		const indexNames = await indexNamesOn('viewer_duplicate_group_pages');
		expect(indexNames.has('vdgp_group_url')).toBe(true);
	});

	it('creates the viewer_mismatches type/url index', async () => {
		const indexNames = await indexNamesOn('viewer_mismatches');
		expect(indexNames.has('vm_type_url')).toBe(true);
	});

	it('reports progress after each CREATE INDEX statement, ending at completed === total (issue #294)', async () => {
		const calls: { completed: number; total: number }[] = [];
		const { rmSync, mkdirSync } = await import('node:fs');
		const progressWorkingDir = path.resolve(
			__dirname,
			'__test_fixtures_create_viewer_read_model_indexes_progress__',
		);
		mkdirSync(progressWorkingDir, { recursive: true });
		const progressArchive = await Archive.create({
			filePath: path.resolve(progressWorkingDir, 'progress-test.nitpicker'),
			cwd: progressWorkingDir,
		});
		try {
			await progressArchive.getKnex().transaction(async (trx) => {
				await createViewerReadModelTables(trx);
				await createViewerReadModelIndexes(trx, (completed, total) => {
					calls.push({ completed, total });
				});
			});

			expect(calls.length).toBeGreaterThan(0);
			expect(calls.every((call, i) => call.completed === i + 1)).toBe(true);
			const last = calls.at(-1)!;
			expect(last.completed).toBe(last.total);
			expect(calls.every((call) => call.total === last.total)).toBe(true);
		} finally {
			await progressArchive.releaseHandle();
			rmSync(progressWorkingDir, { recursive: true, force: true });
		}
	});
});
