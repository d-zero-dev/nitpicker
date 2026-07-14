import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { countViewerResourcesTotal } from './count-viewer-resources-total.js';
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

describe('countViewerResourcesTotal', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_count_viewer_resources_total__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'count-resources-total-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setResources({
			url: parseUrl('https://example.com/a.css')!,
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
			url: parseUrl('https://cdn.example.net/b.js')!,
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

		await populateMigrationTables(archive);
		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('counts every resource when unfiltered', async () => {
		const knex = archive.getKnex();
		expect(await countViewerResourcesTotal(knex, {})).toBe(2);
	});

	it('counts only the matching isExternal subset when filtered', async () => {
		const knex = archive.getKnex();
		expect(await countViewerResourcesTotal(knex, { isExternal: true })).toBe(1);
		expect(await countViewerResourcesTotal(knex, { isExternal: false })).toBe(1);
	});
});
