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

	it('creates all 14 tables with no indexes yet (see createViewerReadModelIndexes)', async () => {
		const knex = archive.getKnex();
		await knex.transaction((trx) => createViewerReadModelTables(trx));

		const tables = [
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
			'viewer_error_kind_entries',
			'viewer_error_kind_meta',
			'viewer_resources',
			'viewer_resource_stats',
		];
		for (const table of tables) {
			expect(await knex.schema.hasTable(table)).toBe(true);
		}

		const indexRows: Array<{ name: string; tbl_name: string }> = await knex(
			'sqlite_master',
		)
			.where('type', 'index')
			.whereIn('tbl_name', tables)
			.andWhere('name', 'not like', 'sqlite_autoindex_%')
			.select('name', 'tbl_name');
		expect(indexRows).toEqual([]);
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

	it('viewer_summary rejects any id other than 1', async () => {
		const knex = archive.getKnex();
		await expect(
			knex('viewer_summary').insert({
				id: 2,
				total_pages: 0,
				internal_pages: 0,
				external_pages: 0,
				internal_contents: 0,
				external_contents: 0,
				status_json: '[]',
				content_type_json: '[]',
				metadata_json: '{}',
			}),
		).rejects.toThrow();
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

	it('viewer_error_kind_entries enforces a composite (host, kind) key, not a single-column rowid, rejecting a duplicate pair', async () => {
		const knex = archive.getKnex();
		const baseRow = {
			count: 1,
			sample_urls_json: '[]',
			overflowed_count: 0,
		};
		await knex('viewer_error_kind_entries').insert({
			host: 'a.example.com',
			kind: 'dns',
			...baseRow,
		});
		await knex('viewer_error_kind_entries').insert({
			host: 'b.example.com',
			kind: 'timeout',
			...baseRow,
		});
		const rows = await knex('viewer_error_kind_entries').select('host').orderBy('host');
		expect(rows.map((r) => r.host)).toEqual(['a.example.com', 'b.example.com']);

		await expect(
			knex('viewer_error_kind_entries').insert({
				host: 'a.example.com',
				kind: 'dns',
				...baseRow,
			}),
		).rejects.toThrow();
	});

	it('viewer_resources rejects a duplicate resource_id', async () => {
		const knex = archive.getKnex();
		await knex('viewer_resources').insert({
			resource_id: 1,
			is_external: 0,
			status: 200,
			status_sort_key: 200,
			status_desc_key: -200,
			source: 'crawled',
			is_unused: 0,
			url_sort_key: 'https://example.com/a.css',
		});
		await expect(
			knex('viewer_resources').insert({
				resource_id: 1,
				is_external: 0,
				status: 200,
				status_sort_key: 200,
				status_desc_key: -200,
				source: 'crawled',
				is_unused: 0,
				url_sort_key: 'https://example.com/duplicate.css',
			}),
		).rejects.toThrow();
	});

	it('viewer_resource_stats rejects a duplicate resource_id', async () => {
		const knex = archive.getKnex();
		await knex('viewer_resource_stats').insert({ resource_id: 1, referrer_count: 1 });
		await expect(
			knex('viewer_resource_stats').insert({ resource_id: 1, referrer_count: 2 }),
		).rejects.toThrow();
	});

	it('viewer_error_kind_meta rejects any id other than 1', async () => {
		const knex = archive.getKnex();
		await expect(
			knex('viewer_error_kind_meta').insert({
				id: 2,
				total_records: 0,
				channel_source: 'none',
			}),
		).rejects.toThrow();
	});
});
