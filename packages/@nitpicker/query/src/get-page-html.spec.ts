import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive, populateMigrationTables } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getPageHtml } from './get-page-html.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_get_page_html__');

describe('getPageHtml', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'get-page-html-test.nitpicker');
	const longHtml = '<html>' + 'a'.repeat(200) + '</html>';

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		const createArchive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		await createArchive.setConfig({
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

		await createArchive.setPage({
			url: parseUrl('https://example.com')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: longHtml.length,
			responseHeaders: {},
			html: longHtml,
			meta: {
				lang: 'ja',
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

		await populateMigrationTables(createArchive);
		// Write to .nitpicker file and reopen so HTML snapshots are zipped/accessible
		await createArchive.write();
		await createArchive.close();

		archive = await Archive.open({
			filePath: archiveFilePath,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('HTML スナップショットを返す', async () => {
		const result = await getPageHtml(archive, 'https://example.com');
		expect(result).not.toBeNull();
		expect(result!.html).toContain('<html>');
		expect(result!.truncated).toBe(false);
	});

	it('maxLength 指定で切り詰められる', async () => {
		const result = await getPageHtml(archive, 'https://example.com', 50);
		expect(result).not.toBeNull();
		expect(result!.html.length).toBeLessThanOrEqual(50);
		expect(result!.truncated).toBe(true);
	});

	it('存在しないページは null を返す', async () => {
		const result = await getPageHtml(archive, 'https://example.com/nonexistent');
		expect(result).toBeNull();
	});
});
