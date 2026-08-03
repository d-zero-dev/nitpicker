import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyViewerResourcesFilters } from './apply-viewer-resources-filters.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.13.0',
	recursive: true,
	interval: 0,
	image: true,
	fetchExternal: false,
	parallels: 1,
	roots: ['https://example.com'],
	excludes: [],
	excludeKeywords: [],
	excludeUrls: [],
	maxExcludedDepth: 0,
	retry: 3,
	fromList: false,
	disableQueries: false,
	userAgent: 'test',
	ignoreRobots: false,
};

describe('applyViewerResourcesFilters', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_resources_filters__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'apply-resources-filters-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setResources({
			url: parseUrl('https://example.com/internal.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 100,
			compress: false,
			cdn: false,
			headers: {},
		});
		await archive.setResources({
			url: parseUrl('https://cdn.example.net/external.js')!,
			isExternal: true,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 200,
			compress: false,
			cdn: false,
			headers: {},
		});
		await archive.setResources({
			url: parseUrl('https://example.com/broken.js')!,
			isExternal: false,
			isError: false,
			status: 404,
			statusText: 'Not Found',
			contentType: 'application/javascript',
			contentLength: 0,
			compress: false,
			cdn: false,
			headers: {},
		});

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('applies no restriction when isExternal/status are omitted', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_resources');
		applyViewerResourcesFilters(qb, {});
		const rows = await qb.select('url_sort_key');
		expect(rows).toHaveLength(3);
	});

	it('filters by exact status — regression test for a dropped status filter', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_resources');
		applyViewerResourcesFilters(qb, { status: 404 });
		const rows = await qb.select('url_sort_key');
		expect(rows.map((r) => r.url_sort_key)).toEqual(['https://example.com/broken.js']);
	});

	it('filters by an array of statuses, OR-ing them together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_resources');
		applyViewerResourcesFilters(qb, { status: [200, 404] });
		const rows = await qb.select('url_sort_key');
		expect(rows).toHaveLength(3);
	});

	it('filters to internal resources only when isExternal is false', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_resources');
		applyViewerResourcesFilters(qb, { isExternal: false });
		const rows = await qb.select('url_sort_key');
		expect(rows.map((r) => r.url_sort_key).toSorted()).toEqual([
			'https://example.com/broken.js',
			'https://example.com/internal.css',
		]);
	});

	it('filters to external resources only when isExternal is true', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_resources');
		applyViewerResourcesFilters(qb, { isExternal: true });
		const rows = await qb.select('url_sort_key');
		expect(rows.map((r) => r.url_sort_key)).toEqual([
			'https://cdn.example.net/external.js',
		]);
	});
});
