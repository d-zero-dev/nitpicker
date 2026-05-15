import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getPageDetail } from './get-page-detail.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_get_page_detail__');

describe('getPageDetail', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'get-page-detail-test.nitpicker');

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
			contentLength: 500,
			responseHeaders: { 'X-Frame-Options': 'DENY' },
			html: '<html><head><title>Home</title></head></html>',
			meta: {
				lang: 'ja',
				title: 'Home',
				description: 'Home page',
				keywords: 'test',
				noindex: false,
				nofollow: false,
				noarchive: false,
				canonical: 'https://example.com/',
				alternate: null,
				'og:type': 'website',
				'og:title': 'Home OG',
				'og:site_name': 'Example',
				'og:description': 'Home OG desc',
				'og:url': 'https://example.com/',
				'og:image': 'https://example.com/og.png',
				'twitter:card': 'summary',
			},
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About us',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/about')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 300,
			responseHeaders: {},
			html: '<html><head><title>About</title></head></html>',
			meta: {
				lang: 'ja',
				title: 'About',
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
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('ページの詳細メタデータを返す', async () => {
		const result = await getPageDetail(archive, 'https://example.com');
		expect(result).not.toBeNull();
		expect(result!.url).toBe('https://example.com');
		expect(result!.title).toBe('Home');
		expect(result!.description).toBe('Home page');
		expect(result!.ogTitle).toBe('Home OG');
		expect(result!.twitterCard).toBe('summary');
		expect(result!.status).toBe(200);
	});

	it('レスポンスヘッダーをパースして返す', async () => {
		const result = await getPageDetail(archive, 'https://example.com');
		expect(result!.responseHeaders).toEqual({ 'X-Frame-Options': 'DENY' });
	});

	it('アウトバウンドリンクを返す', async () => {
		const result = await getPageDetail(archive, 'https://example.com');
		expect(result!.outboundLinks).toHaveLength(1);
		expect(result!.outboundLinks[0]!.url).toBe('https://example.com/about');
		expect(result!.outboundLinks[0]!.textContent).toBe('About us');
	});

	it('インバウンドリンクを返す', async () => {
		const result = await getPageDetail(archive, 'https://example.com/about');
		expect(result!.inboundLinks).toHaveLength(1);
		expect(result!.inboundLinks[0]!.url).toContain('example.com');
	});

	it('存在しないページは null を返す', async () => {
		const result = await getPageDetail(archive, 'https://example.com/nonexistent');
		expect(result).toBeNull();
	});
});
