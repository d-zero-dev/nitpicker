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

	it('creates all 26 tables with no indexes yet (see createViewerReadModelIndexes)', async () => {
		const knex = archive.getKnex();
		await knex.transaction((trx) => createViewerReadModelTables(trx));

		const tables = [
			'viewer_read_model_meta',
			'viewer_summary',
			'viewer_pages',
			'viewer_url_refs',
			'viewer_query_profiles',
			'viewer_count_buckets',
			'viewer_page_anchors',
			'viewer_directory_nodes',
			'viewer_directory_pages',
			'viewer_external_links',
			'viewer_anchor_facts',
			'viewer_error_kind_entries',
			'viewer_error_kind_meta',
			'viewer_isolated_components',
			'viewer_isolated_component_pages',
			'viewer_graph_nodes',
			'viewer_graph_edges',
			'viewer_resources',
			'viewer_resource_stats',
			'viewer_images',
			'viewer_header_checks',
			'viewer_duplicate_groups',
			'viewer_duplicate_group_pages',
			'viewer_mismatches',
			'viewer_technology_summary',
			'viewer_technology_directory_stats',
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

	it('creates viewer_pages.is_dedupe_capped as a NOT NULL boolean defaulting to 0', async () => {
		const knex = archive.getKnex();

		const columns = (await knex.raw("PRAGMA table_info('viewer_pages')")) as {
			name: string;
			notnull: number;
			dflt_value: string | null;
		}[];
		const column = columns.find((c) => c.name === 'is_dedupe_capped');
		expect(column?.notnull).toBe(1);
		expect(column?.dflt_value).toBe('0');
	});

	it('creates viewer_pages.dedupe_cap_event_id as a nullable integer', async () => {
		const knex = archive.getKnex();

		const columns = (await knex.raw("PRAGMA table_info('viewer_pages')")) as {
			name: string;
			notnull: number;
		}[];
		const column = columns.find((c) => c.name === 'dedupe_cap_event_id');
		expect(column?.notnull).toBe(0);
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
			direct_html_page_count: 0,
			descendant_html_page_count: 0,
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
				network_outage_affected_failures: 0,
			}),
		).rejects.toThrow();
	});

	it('viewer_external_links rejects a duplicate dest_page_id', async () => {
		const knex = archive.getKnex();
		await knex('viewer_url_refs').insert([
			{ id: 1, url: 'https://ads.example.com/' },
			{ id: 2, url: 'https://ads.example.com/duplicate' },
		]);
		await knex('viewer_external_links').insert({
			dest_page_id: 1,
			dest_url_ref_id: 1,
			status: 200,
			referrer_count: 1,
		});
		await expect(
			knex('viewer_external_links').insert({
				dest_page_id: 1,
				dest_url_ref_id: 2,
				status: 200,
				referrer_count: 2,
			}),
		).rejects.toThrow();
	});

	it('viewer_url_refs rejects a duplicate URL', async () => {
		const knex = archive.getKnex();
		await knex('viewer_url_refs').insert({ id: 10, url: 'https://example.com/ref' });
		await expect(
			knex('viewer_url_refs').insert({
				id: 11,
				url: 'https://example.com/ref',
			}),
		).rejects.toThrow();
	});

	it('viewer_error_kind_entries enforces a composite (host, kind, attribution) key, not a single-column rowid, rejecting a duplicate triple', async () => {
		const knex = archive.getKnex();
		const baseRow = {
			count: 1,
			sample_urls_json: '[]',
			overflowed_count: 0,
		};
		await knex('viewer_error_kind_entries').insert({
			host: 'a.example.com',
			kind: 'dns',
			attribution: 'site',
			...baseRow,
		});
		await knex('viewer_error_kind_entries').insert({
			host: 'b.example.com',
			kind: 'timeout',
			attribution: 'site',
			...baseRow,
		});
		const rows = await knex('viewer_error_kind_entries').select('host').orderBy('host');
		expect(rows.map((r) => r.host)).toEqual(['a.example.com', 'b.example.com']);

		await expect(
			knex('viewer_error_kind_entries').insert({
				host: 'a.example.com',
				kind: 'dns',
				attribution: 'site',
				...baseRow,
			}),
		).rejects.toThrow();
	});

	it('viewer_error_kind_entries allows the same (host, kind) twice when attribution differs', async () => {
		// The whole point of widening the PK to include attribution: a
		// host×kind pair can have both site-caused and outage-caused
		// failures, and they must coexist as two independent rows. Uses a
		// host/kind pair not touched by the composite-key test above — this
		// describe block shares one archive across all its tests (`beforeAll`,
		// not `beforeEach`), so rows persist between tests.
		const knex = archive.getKnex();
		const baseRow = {
			count: 1,
			sample_urls_json: '[]',
			overflowed_count: 0,
		};
		await knex('viewer_error_kind_entries').insert({
			host: 'c.example.com',
			kind: 'connection-timeout',
			attribution: 'site',
			...baseRow,
		});
		await expect(
			knex('viewer_error_kind_entries').insert({
				host: 'c.example.com',
				kind: 'connection-timeout',
				attribution: 'network',
				...baseRow,
			}),
		).resolves.not.toThrow();
		const rows = await knex('viewer_error_kind_entries')
			.where({ host: 'c.example.com', kind: 'connection-timeout' })
			.select('attribution');
		expect(rows.map((r) => r.attribution).toSorted()).toEqual(['network', 'site']);
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
			referrer_count: 0,
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
				referrer_count: 0,
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

	it('viewer_images rejects a duplicate image_id', async () => {
		const knex = archive.getKnex();
		await knex('viewer_images').insert({
			image_id: 1,
			page_url_rank: 0,
			missing_alt: 0,
			missing_dimensions: 0,
			width: 100,
			height: 100,
			natural_width: 100,
			natural_height: 100,
			is_lazy: 0,
		});
		await expect(
			knex('viewer_images').insert({
				image_id: 1,
				page_url_rank: 1,
				missing_alt: 1,
				missing_dimensions: 1,
				width: 0,
				height: 0,
				natural_width: 0,
				natural_height: 0,
				is_lazy: 1,
			}),
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

	it('viewer_duplicate_groups rejects a duplicate group_id', async () => {
		const knex = archive.getKnex();
		await knex('viewer_duplicate_groups').insert({
			group_id: 1,
			field: 'title',
			value: 'Duplicate Title',
			count: 2,
			count_desc_key: -2,
		});
		await expect(
			knex('viewer_duplicate_groups').insert({
				group_id: 1,
				field: 'description',
				value: 'Duplicate Description',
				count: 3,
				count_desc_key: -3,
			}),
		).rejects.toThrow();
	});

	it('viewer_duplicate_group_pages enforces a composite (group_id, page_id) key, not a single-column rowid', async () => {
		const knex = archive.getKnex();
		await knex('viewer_duplicate_group_pages').insert([
			{ group_id: 1, page_id: 1, url_sort_key: 'https://example.com/a' },
			{ group_id: 1, page_id: 2, url_sort_key: 'https://example.com/b' },
		]);
		const rows = await knex('viewer_duplicate_group_pages')
			.select('page_id')
			.orderBy('page_id');
		expect(rows.map((r) => r.page_id)).toEqual([1, 2]);

		await expect(
			knex('viewer_duplicate_group_pages').insert({
				group_id: 1,
				page_id: 1,
				url_sort_key: 'https://example.com/duplicate',
			}),
		).rejects.toThrow();
	});

	it('viewer_mismatches auto-assigns mismatch_id, allowing multiple rows for the same page', async () => {
		const knex = archive.getKnex();
		await knex('viewer_mismatches').insert([
			{
				type: 'canonical',
				page_id: 1,
				url_sort_key: 'https://example.com/a',
				actual: 'https://example.com/a',
				expected: 'https://example.com/canonical-a',
				natural_url_rank: 0,
			},
			{
				type: 'og:title',
				page_id: 1,
				url_sort_key: 'https://example.com/a',
				actual: 'OG Title',
				expected: 'Title',
				natural_url_rank: 0,
			},
		]);
		const rows = await knex('viewer_mismatches').select('mismatch_id', 'type');
		expect(rows).toHaveLength(2);
		expect(new Set(rows.map((r) => r.mismatch_id)).size).toBe(2);
	});
});
