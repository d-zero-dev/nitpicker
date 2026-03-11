import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listPages } from './list-pages.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_pages__');

describe('listPages', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'list-pages-test.nitpicker');

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
			version: '0.4.4',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			scope: [],
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
			{
				url: 'https://example.com/',
				status: 200,
				title: 'Home',
				description: 'Home page',
			},
			{
				url: 'https://example.com/about',
				status: 200,
				title: 'About',
				description: null,
			},
			{
				url: 'https://example.com/contact',
				status: 404,
				title: null,
				description: null,
			},
		];

		for (const p of pages) {
			await archive.setPage({
				url: parseUrl(p.url)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: p.status,
				statusText: p.status === 200 ? 'OK' : 'Not Found',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: `<html><head><title>${p.title ?? ''}</title></head></html>`,
				meta: {
					lang: 'ja',
					title: p.title,
					description: p.description,
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

	it('全ページをリストする', async () => {
		const result = await listPages(archive);
		expect(result.total).toBe(3);
		expect(result.items).toHaveLength(3);
	});

	it('ステータスコードでフィルタする', async () => {
		const result = await listPages(archive, { status: 404 });
		expect(result.total).toBe(1);
		expect(result.items[0]?.url).toBe('https://example.com/contact');
	});

	it('タイトル欠損ページをフィルタする', async () => {
		const result = await listPages(archive, { missingTitle: true });
		expect(result.total).toBe(1);
		expect(result.items[0]?.url).toBe('https://example.com/contact');
	});

	it('ページネーションが機能する', async () => {
		const result = await listPages(archive, { limit: 1, offset: 1 });
		expect(result.items).toHaveLength(1);
		expect(result.limit).toBe(1);
		expect(result.offset).toBe(1);
	});
});
