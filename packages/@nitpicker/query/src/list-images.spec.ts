import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listImages } from './list-images.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_images__');

describe('listImages', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'list-images-test.nitpicker');

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
			imageList: [
				{
					src: 'https://example.com/logo.png',
					currentSrc: 'https://example.com/logo.png',
					alt: 'Logo',
					width: 200,
					height: 100,
					naturalWidth: 400,
					naturalHeight: 200,
					isLazy: false,
					viewportWidth: 1280,
					sourceCode: '<img src="logo.png" alt="Logo">',
				},
				{
					src: 'https://example.com/hero.jpg',
					currentSrc: 'https://example.com/hero.jpg',
					alt: '',
					width: 0,
					height: 0,
					naturalWidth: 1920,
					naturalHeight: 1080,
					isLazy: true,
					viewportWidth: 1280,
					sourceCode: '<img src="hero.jpg" alt="" loading="lazy">',
				},
			],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('全画像をリストする', async () => {
		const result = await listImages(archive);
		expect(result.total).toBe(2);
		expect(result.items).toHaveLength(2);
	});

	it('alt 欠損画像をフィルタする', async () => {
		const result = await listImages(archive, { missingAlt: true });
		expect(result.total).toBe(1);
		expect(result.items[0]!.src).toBe('https://example.com/hero.jpg');
	});

	it('寸法欠損画像をフィルタする', async () => {
		const result = await listImages(archive, { missingDimensions: true });
		expect(result.total).toBe(1);
		expect(result.items[0]!.width).toBe(0);
	});

	it('oversizedThreshold でフィルタする', async () => {
		const result = await listImages(archive, { oversizedThreshold: 1000 });
		expect(result.total).toBe(1);
		expect(result.items[0]!.naturalWidth).toBe(1920);
	});

	it('ページネーションが機能する', async () => {
		const result = await listImages(archive, { limit: 1 });
		expect(result.items).toHaveLength(1);
		expect(result.limit).toBe(1);
	});
});
