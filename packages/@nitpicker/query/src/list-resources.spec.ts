import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listResources } from './list-resources.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_resources__');

describe('listResources', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'list-resources-test.nitpicker');

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

		await archive.setResources({
			url: parseUrl('https://example.com/style.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 1000,
			compress: 'gzip',
			cdn: false,
			headers: null,
		});

		await archive.setResources({
			url: parseUrl('https://cdn.example.com/app.js')!,
			isExternal: true,
			isError: false,
			status: 404,
			statusText: 'Not Found',
			contentType: 'application/javascript',
			contentLength: 5000,
			compress: false,
			cdn: 'cloudflare',
			headers: null,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('全リソースをリストする', async () => {
		const result = await listResources(archive);
		expect(result.total).toBe(2);
		expect(result.items).toHaveLength(2);
	});

	it('contentType でフィルタする', async () => {
		const result = await listResources(archive, { contentType: 'text/css' });
		expect(result.total).toBe(1);
		expect(result.items[0]!.url).toBe('https://example.com/style.css');
	});

	it('isExternal でフィルタする', async () => {
		const result = await listResources(archive, { isExternal: true });
		expect(result.total).toBe(1);
		expect(result.items[0]!.url).toBe('https://cdn.example.com/app.js');
	});

	it('status でフィルタする', async () => {
		const result = await listResources(archive, { status: 200 });
		expect(result.total).toBe(1);
		expect(result.items[0]!.url).toBe('https://example.com/style.css');
	});

	it('ページネーションが機能する', async () => {
		const result = await listResources(archive, { limit: 1, offset: 0 });
		expect(result.items).toHaveLength(1);
		expect(result.limit).toBe(1);
		expect(result.offset).toBe(0);
	});

	it('compress/cdn が false の場合、格納時の TEXT affinity 変換 (0 -> "0.0") を経ても null に正規化する', async () => {
		const result = await listResources(archive, { contentType: 'text/css' });
		// style.css was created with `compress: 'gzip', cdn: false`.
		expect(result.items[0]).toMatchObject({ compress: 'gzip', cdn: null });

		const external = await listResources(archive, { isExternal: true });
		// app.js was created with `compress: false, cdn: 'cloudflare'`.
		expect(external.items[0]).toMatchObject({ compress: null, cdn: 'cloudflare' });
	});
});
