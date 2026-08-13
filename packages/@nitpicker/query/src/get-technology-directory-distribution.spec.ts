import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTechnologyDirectoryDistribution } from './get-technology-directory-distribution.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_get_technology_directory_distribution__',
);

describe('getTechnologyDirectoryDistribution', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
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
		});
		await archive.setPage({
			url: parseUrl('https://example.com/blog/post-1')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 500,
			responseHeaders: {},
			html: '<html><div id="__next"></div></html>',
			meta: { tags: { detected: {}, entries: [] } } as never,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty array when the read model has not been built', async () => {
		expect(await getTechnologyDirectoryDistribution(archive)).toEqual([]);
	});

	it('returns the directory x technology distribution once the read model is built', async () => {
		await buildViewerReadModel(archive);
		const rows = await getTechnologyDirectoryDistribution(archive);
		expect(rows).toEqual([
			{
				rootKey: 'https://example.com',
				directory: 'https://example.com/blog/',
				technology: 'Next.js',
				pageCount: 1,
			},
		]);
	});
});
