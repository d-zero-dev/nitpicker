import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from './build-viewer-read-model.js';
import { dropViewerReadModel } from './drop-viewer-read-model.js';
import { hasViewerReadModel } from './has-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_drop_viewer_read_model__');

describe('dropViewerReadModel', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'drop-test.nitpicker');

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
			meta: {
				lang: null,
				title: 'Home',
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
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('is a no-op when nothing was ever built', async () => {
		await expect(dropViewerReadModel(archive)).resolves.toBeUndefined();
		expect(await hasViewerReadModel(archive)).toBe(false);
	});

	it('drops the read-model tables after a build, leaving the write model untouched', async () => {
		await buildViewerReadModel(archive);
		expect(await hasViewerReadModel(archive)).toBe(true);

		const knex = archive.getKnex();
		const pagesBefore = await knex('pages').count<{ count: string }[]>({ count: '*' });

		await dropViewerReadModel(archive);

		expect(await hasViewerReadModel(archive)).toBe(false);
		for (const table of [
			'viewer_pages',
			'viewer_query_profiles',
			'viewer_count_buckets',
			'viewer_page_anchors',
		]) {
			expect(await knex.schema.hasTable(table)).toBe(false);
		}

		const pagesAfter = await knex('pages').count<{ count: string }[]>({ count: '*' });
		expect(pagesAfter[0]?.count).toBe(pagesBefore[0]?.count);
	});

	it('throws on a read-only accessor and leaves the archive untouched', async () => {
		await buildViewerReadModel(archive);
		const readOnlyAccessor = await Archive.connect(archive.tmpDir);
		try {
			await expect(dropViewerReadModel(readOnlyAccessor)).rejects.toThrow(/read-only/i);
			expect(await hasViewerReadModel(archive)).toBe(true);
		} finally {
			await readOnlyAccessor.close();
			await dropViewerReadModel(archive);
		}
	});
});
