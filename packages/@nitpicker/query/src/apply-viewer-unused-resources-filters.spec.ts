import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyViewerUnusedResourcesFilters } from './apply-viewer-unused-resources-filters.js';
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

describe('applyViewerUnusedResourcesFilters', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_unused_resources_filters__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'apply-unused-resources-filters-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setResources(
			{
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
			},
			'inventory-seed',
		);
		// A referenced resource — never `is_unused = 1`, so it must be
		// excluded by the fixed base predicate regardless of other filters.
		await archive.setResources({
			url: parseUrl('https://example.com/used.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 500,
			compress: false,
			cdn: false,
			headers: {},
		});
		await archive.setPage({
			url: parseUrl('https://example.com/page-using-css')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: {
				lang: null,
				title: null,
				description: null,
				keywords: null,
				noindex: false,
				nofollow: false,
				noarchive: false,
				canonical: null,
				alternate: null,
				'og:type': null,
				'og:title': null,
				'og:site_name': null,
				'og:description': null,
				'og:url': null,
				'og:image': null,
				'twitter:card': null,
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/page-using-css',
			src: 'https://example.com/used.css',
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

	it('always restricts to is_unused = 1, excluding a referenced resource', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_resources');
		applyViewerUnusedResourcesFilters(qb, {});
		const rows = await qb.select('url_sort_key');
		expect(rows.map((r) => r.url_sort_key)).toEqual(['https://example.com/orphan.pdf']);
	});

	it('applies the source filter on top of the fixed base predicate', async () => {
		const knex = archive.getKnex();
		const matching = knex('viewer_resources');
		applyViewerUnusedResourcesFilters(matching, { source: 'inventory-seed' });
		expect(await matching.select('url_sort_key')).toHaveLength(1);

		const nonMatching = knex('viewer_resources');
		applyViewerUnusedResourcesFilters(nonMatching, { source: 'crawled' });
		expect(await nonMatching.select('url_sort_key')).toHaveLength(0);
	});
});
