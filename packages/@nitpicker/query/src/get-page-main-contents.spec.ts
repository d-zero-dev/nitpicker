import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getPageMainContents } from './get-page-main-contents.js';
import { makeBeholderMeta } from './test-helpers/make-beholder-meta.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_get_page_main_contents__');

describe('getPageMainContents', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'get-page-main-contents-test.nitpicker',
	);

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
			contentLength: 500,
			responseHeaders: {},
			html: '<html><head><title>Home</title></head></html>',
			meta: makeBeholderMeta({ lang: 'ja', title: 'Home' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
			mainContents: {
				title: 'Home',
				main: {
					nodeName: 'MAIN',
					id: null,
					classList: ['l-main'],
					role: null,
					selector: 'main.l-main',
				},
				wordCount: 100,
				bodyWordCount: 150,
				headings: [
					{ text: 'Second', level: 2 },
					{ text: 'First', level: 1 },
				],
				images: [{ src: 'https://example.com/a.png', alt: 'A' }],
				tables: [
					{ rows: 2, cols: 3, hasHeader: true, hasFooter: false, hasMergedCell: true },
				],
				buttons: [
					{
						nodeName: 'BUTTON',
						role: null,
						type: 'submit',
						text: 'Send',
						disabled: false,
					},
				],
				iframes: [
					{
						src: 'https://example.com/embed.html',
						title: 'Embed',
						width: '640',
						height: '360',
					},
				],
				videos: [
					{
						src: 'https://example.com/a.mp4',
						poster: 'https://example.com/a.jpg',
						width: 640,
						height: 360,
					},
				],
				audios: [{ src: 'https://example.com/a.mp3' }],
				canvases: [{ width: 300, height: 150 }],
			},
			scrollHeight: { desktop: 3200, mobile: 5400 },
		});

		await archive.setPage({
			url: parseUrl('https://example.com/metadata-only')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: makeBeholderMeta({ lang: 'ja', title: 'Metadata only' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
			mainContents: null,
			scrollHeight: null,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns the detected main element, scalar metrics, and ordered child rows', async () => {
		const result = await getPageMainContents(archive, 'https://example.com');
		expect(result).not.toBeNull();
		expect(result!.main).toEqual({
			nodeName: 'MAIN',
			id: null,
			role: null,
			selector: 'main.l-main',
			classList: ['l-main'],
		});
		expect(result!.wordCount).toBe(100);
		expect(result!.bodyWordCount).toBe(150);
		expect(result!.scrollHeight).toEqual({ desktop: 3200, mobile: 5400 });
		expect(result!.headings.map((h) => h.text)).toEqual(['Second', 'First']);
		expect(result!.images).toEqual([{ src: 'https://example.com/a.png', alt: 'A' }]);
		expect(result!.tables).toEqual([
			{ rows: 2, cols: 3, hasHeader: true, hasFooter: false, hasMergedCell: true },
		]);
		expect(result!.buttons).toEqual([
			{ nodeName: 'BUTTON', role: null, type: 'submit', text: 'Send', disabled: false },
		]);
		expect(result!.iframes).toEqual([
			{
				src: 'https://example.com/embed.html',
				title: 'Embed',
				width: '640',
				height: '360',
			},
		]);
		expect(result!.videos).toEqual([
			{
				src: 'https://example.com/a.mp4',
				poster: 'https://example.com/a.jpg',
				width: 640,
				height: 360,
			},
		]);
		expect(result!.audios).toEqual([{ src: 'https://example.com/a.mp3' }]);
		expect(result!.canvases).toEqual([{ width: 300, height: 150 }]);
	});

	it('returns null when the page has no mainContents (metadata-only scrape)', async () => {
		const result = await getPageMainContents(
			archive,
			'https://example.com/metadata-only',
		);
		expect(result).toBeNull();
	});

	it('returns null when the URL does not exist in the archive', async () => {
		const result = await getPageMainContents(
			archive,
			'https://example.com/does-not-exist',
		);
		expect(result).toBeNull();
	});
});
