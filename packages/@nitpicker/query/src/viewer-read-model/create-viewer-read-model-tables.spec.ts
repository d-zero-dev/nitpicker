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

	it('creates all 9 tables and the named viewer_pages indexes', async () => {
		const knex = archive.getKnex();
		await knex.transaction((trx) => createViewerReadModelTables(trx));

		for (const table of [
			'viewer_read_model_meta',
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

		const indexRows: Array<{ name: string }> = await knex('sqlite_master')
			.where({ type: 'index', tbl_name: 'viewer_pages' })
			.select('name');
		const indexNames = new Set(indexRows.map((r) => r.name));
		for (const indexName of [
			'vp_default',
			'vp_status',
			'vp_status_desc',
			'vp_title',
			'vp_missing_title',
			'vp_missing_description',
			'vp_noindex',
			'vp_source',
		]) {
			expect(indexNames.has(indexName)).toBe(true);
		}

		const externalLinkIndexRows: Array<{ name: string }> = await knex('sqlite_master')
			.where({ type: 'index', tbl_name: 'viewer_external_links' })
			.select('name');
		const externalLinkIndexNames = new Set(externalLinkIndexRows.map((r) => r.name));
		for (const indexName of ['vel_url', 'vel_status', 'vel_referrer_count']) {
			expect(externalLinkIndexNames.has(indexName)).toBe(true);
		}

		const anchorFactIndexRows: Array<{ name: string }> = await knex('sqlite_master')
			.where({ type: 'index', tbl_name: 'viewer_anchor_facts' })
			.select('name');
		const anchorFactIndexNames = new Set(anchorFactIndexRows.map((r) => r.name));
		for (const indexName of [
			'vaf_broken_source',
			'vaf_broken_dest',
			'vaf_broken_status',
			'vaf_broken_status_desc',
			'vaf_source',
			'vaf_dest',
		]) {
			expect(anchorFactIndexNames.has(indexName)).toBe(true);
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

	it('viewer_directory_nodes enforces a unique (root_key, path) constraint', async () => {
		const knex = archive.getKnex();
		const baseNode = {
			parent_node_id: null,
			root_key: 'example.com',
			depth: 0,
			name: '',
			path: '/',
			name_sort_key: '',
			path_sort_key: '/',
			direct_child_dir_count: 0,
			direct_page_count: 0,
			descendant_page_count: 0,
			internal_descendant_page_count: 0,
			external_descendant_page_count: 0,
			has_children: 0,
		};
		await knex('viewer_directory_nodes').insert({ node_id: 1, ...baseNode });
		await expect(
			knex('viewer_directory_nodes').insert({ node_id: 2, ...baseNode }),
		).rejects.toThrow();
	});

	it('viewer_directory_pages enforces a composite (node_id, page_id) key, not a single-column rowid', async () => {
		const knex = archive.getKnex();
		await knex('viewer_directory_pages').insert([
			{ node_id: 1, page_id: 1, page_url_sort_key: 'https://example.com/a' },
			{ node_id: 1, page_id: 2, page_url_sort_key: 'https://example.com/b' },
		]);
		const rows = await knex('viewer_directory_pages')
			.select('page_id')
			.orderBy('page_id');
		expect(rows.map((r) => r.page_id)).toEqual([1, 2]);
	});

	it('viewer_external_links rejects a duplicate dest_page_id', async () => {
		const knex = archive.getKnex();
		await knex('viewer_external_links').insert({
			dest_page_id: 1,
			dest_url: 'https://ads.example.com/',
			status: 200,
			referrer_count: 1,
		});
		await expect(
			knex('viewer_external_links').insert({
				dest_page_id: 1,
				dest_url: 'https://ads.example.com/duplicate',
				status: 200,
				referrer_count: 2,
			}),
		).rejects.toThrow();
	});
});
