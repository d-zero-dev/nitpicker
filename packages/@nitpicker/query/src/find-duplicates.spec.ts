import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findDuplicates } from './find-duplicates.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_duplicates__');

describe('findDuplicates', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'dup-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		await archive.setConfig({
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
		});

		const pages = [
			{ url: 'https://example.com/a', title: 'Duplicate Title' },
			{ url: 'https://example.com/b', title: 'Duplicate Title' },
			{ url: 'https://example.com/c', title: 'Unique Title' },
		];

		for (const p of pages) {
			await archive.setPage({
				url: parseUrl(p.url)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: `<html><head><title>${p.title}</title></head></html>`,
				meta: {
					lang: 'ja',
					title: p.title,
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
		}
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('重複タイトルを検出する', async () => {
		const result = await findDuplicates(archive, 'title');
		expect(result).toHaveLength(1);
		expect(result[0]?.value).toBe('Duplicate Title');
		expect(result[0]?.urls).toHaveLength(2);
		expect(result[0]?.count).toBe(2);
	});
});
