import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSummary } from './get-summary.js';
import { getViewerSummary } from './get-viewer-summary.js';
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

const META = {
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
};

describe('getViewerSummary', () => {
	describe('no read model built', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_get_viewer_summary_no_model__',
		);
		const archiveFilePath = path.resolve(workingDir, 'no-model-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);
			await populateMigrationTables(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('throws — callers must guard with isViewerReadModelCurrent() first', async () => {
			await expect(getViewerSummary(archive)).rejects.toThrow(/viewer_summary/);
		});
	});

	describe('with read model built', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_get_viewer_summary_built__',
		);
		const archiveFilePath = path.resolve(workingDir, 'built-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			await archive.setPage({
				url: parseUrl('https://example.com/')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...META, title: 'Home', description: 'Home description' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});

			await archive.setPage({
				url: parseUrl('https://example.net/')!,
				redirectPaths: [],
				isExternal: true,
				isTarget: false,
				status: 404,
				statusText: 'Not Found',
				contentType: 'text/html',
				contentLength: 0,
				responseHeaders: {},
				html: '',
				meta: META,
				anchorList: [],
				imageList: [],
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

		it('matches a getSummary() (legacy) snapshot of the same archive', async () => {
			const [viewerSummary, legacySummary] = await Promise.all([
				getViewerSummary(archive),
				getSummary(archive),
			]);
			expect(viewerSummary).toEqual(legacySummary);
		});

		it("computes the 2-page fixture's counts/distributions independently of getSummary() (hardcoded expectations)", async () => {
			// Cross-checking against getSummary() (the test above) proves the
			// two implementations agree, but would not catch a bug shared by
			// both. These hardcoded literals pin the actual expected values
			// independently, derived by hand from the fixture above (home:
			// 200/internal/html/title+description, example.net: 404/external/html).
			const result = await getViewerSummary(archive);
			expect(result).toMatchObject({
				totalPages: 2,
				internalPages: 1,
				externalPages: 1,
				internalContents: 1,
				externalContents: 1,
				statusDistribution: [
					{ status: 200, count: 1 },
					{ status: 404, count: 1 },
				],
				contentTypeDistribution: [{ category: 'html', internal: 1, external: 1 }],
				metadataFulfillment: {
					title: 1,
					description: 1,
					keywords: 0,
					ogTitle: 0,
					ogDescription: 0,
					ogImage: 0,
				},
			});
		});

		it('reads baseUrl/roots from the archive config, not from the read model', async () => {
			const result = await getViewerSummary(archive);
			expect(result.baseUrl).toBe('https://example.com');
			expect(result.roots).toEqual(['https://example.com']);
		});
	});
});
