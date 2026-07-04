import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { countViewerUnusedResourcesTotal } from './count-viewer-unused-resources-total.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.10.0',
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

describe('countViewerUnusedResourcesTotal', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_count_viewer_unused_resources_total__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'count-unused-resources-total-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		// Unreferenced, internal — counted as unused.
		await archive.setResources({
			url: parseUrl('https://example.com/orphan.pdf')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/pdf',
			contentLength: 1000,
			compress: false,
			cdn: false,
			headers: {},
		});
		// Unreferenced, external — not counted (is_unused is never set for
		// external resources, see `computeResourceInsertRows`).
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

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('counts only the is_unused=1 subset, excluding external resources', async () => {
		const knex = archive.getKnex();
		expect(await countViewerUnusedResourcesTotal(knex, {})).toBe(1);
	});

	it('applies the status filter on top of the fixed is_unused=1 base predicate', async () => {
		const knex = archive.getKnex();
		expect(await countViewerUnusedResourcesTotal(knex, { status: 200 })).toBe(1);
		expect(await countViewerUnusedResourcesTotal(knex, { status: 404 })).toBe(0);
	});
});
