import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyViewerImagesFilters } from './apply-viewer-images-filters.js';
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

const NOOP_META = {
	lang: null,
	title: 'Page',
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
};

describe('applyViewerImagesFilters', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_apply_viewer_images_filters__',
	);
	const archiveFilePath = path.resolve(workingDir, 'apply-images-filters-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/page')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: NOOP_META,
			anchorList: [],
			imageList: [
				{
					src: 'https://example.com/normal.png',
					currentSrc: 'https://example.com/normal.png',
					alt: 'A normal image',
					width: 100,
					height: 100,
					naturalWidth: 100,
					naturalHeight: 100,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="normal.png" alt="A normal image">',
				},
				{
					src: 'https://example.com/no-alt.png',
					currentSrc: 'https://example.com/no-alt.png',
					alt: '',
					width: 100,
					height: 100,
					naturalWidth: 100,
					naturalHeight: 100,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="no-alt.png">',
				},
				{
					src: 'https://example.com/no-dimensions.png',
					currentSrc: 'https://example.com/no-dimensions.png',
					alt: 'Missing dimensions',
					width: 0,
					height: 0,
					naturalWidth: 500,
					naturalHeight: 500,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="no-dimensions.png" alt="Missing dimensions">',
				},
				{
					src: 'https://example.com/oversized.png',
					currentSrc: 'https://example.com/oversized.png',
					alt: 'Oversized',
					width: 100,
					height: 100,
					naturalWidth: 5000,
					naturalHeight: 100,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="oversized.png" alt="Oversized">',
				},
			],
			isSkipped: false,
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

	it('applies no restriction when every filter is omitted', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_images');
		applyViewerImagesFilters(qb, {});
		const rows = await qb.select('image_id');
		expect(rows).toHaveLength(4);
	});

	it('filters to images missing alt text', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_images');
		applyViewerImagesFilters(qb, { missingAlt: true });
		const rows = await qb.select('missing_alt');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.missing_alt).toBe(1);
	});

	it('filters to images missing explicit dimensions', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_images');
		applyViewerImagesFilters(qb, { missingDimensions: true });
		const rows = await qb.select('missing_dimensions');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.missing_dimensions).toBe(1);
	});

	it('treats missingAlt: false as an explicit filter to images that already have alt text — regression test for a false-treated-as-omitted bug', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_images');
		applyViewerImagesFilters(qb, { missingAlt: false });
		const rows = await qb.select('missing_alt');
		expect(rows).toHaveLength(3);
		expect(rows.every((row) => row.missing_alt === 0)).toBe(true);
	});

	it('treats missingDimensions: false as an explicit filter to images that already have dimensions', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_images');
		applyViewerImagesFilters(qb, { missingDimensions: false });
		const rows = await qb.select('missing_dimensions');
		expect(rows).toHaveLength(3);
		expect(rows.every((row) => row.missing_dimensions === 0)).toBe(true);
	});

	it('applies no restriction when missingAlt is both true and false, OR-ed together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_images');
		applyViewerImagesFilters(qb, { missingAlt: [true, false] });
		const rows = await qb.select('image_id');
		expect(rows).toHaveLength(4);
	});

	it('applies no missingAlt restriction when the array is empty — regression test for a truthy-check-on-[] bug', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_images');
		applyViewerImagesFilters(qb, { missingAlt: [] });
		const rows = await qb.select('image_id');
		expect(rows).toHaveLength(4);
	});

	it('applies no restriction when missingDimensions is both true and false, OR-ed together', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_images');
		applyViewerImagesFilters(qb, { missingDimensions: [true, false] });
		const rows = await qb.select('image_id');
		expect(rows).toHaveLength(4);
	});

	it('applies no missingDimensions restriction when the array is empty — regression test for a truthy-check-on-[] bug', async () => {
		const knex = archive.getKnex();
		const qb = knex('viewer_images');
		applyViewerImagesFilters(qb, { missingDimensions: [] });
		const rows = await qb.select('image_id');
		expect(rows).toHaveLength(4);
	});

	it('filters to images exceeding an arbitrary oversized threshold at request time', async () => {
		const knex = archive.getKnex();

		const strict = knex('viewer_images');
		applyViewerImagesFilters(strict, { oversizedThreshold: 1000 });
		expect(await strict.select('image_id')).toHaveLength(1);

		const lenient = knex('viewer_images');
		applyViewerImagesFilters(lenient, { oversizedThreshold: 10_000 });
		expect(await lenient.select('image_id')).toHaveLength(0);
	});
});
