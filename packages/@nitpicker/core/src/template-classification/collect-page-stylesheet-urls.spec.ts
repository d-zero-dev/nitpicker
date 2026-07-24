import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { collectPageStylesheetUrls } from './collect-page-stylesheet-urls.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_collect_page_stylesheet_urls__',
);

const baseMeta = {
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
} as const;

describe('collectPageStylesheetUrls', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'collect-page-stylesheet-urls-test.nitpicker',
	);

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

		// /a and /b share both style-a.css and shared.css (same interned set).
		// /c loads only shared.css (a different set). /d loads no CSS at all.
		for (const p of ['/a', '/b', '/c', '/d']) {
			await archive.setPage({
				url: parseUrl(`https://example.com${p}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: baseMeta,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		await archive.setResources({
			url: parseUrl('https://example.com/style-a.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 500,
			compress: false,
			cdn: false,
			headers: null,
		});
		await archive.setResources({
			url: parseUrl('https://example.com/shared.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 200,
			compress: false,
			cdn: false,
			headers: null,
		});
		await archive.setResources({
			url: parseUrl('https://example.com/app.js')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 300,
			compress: false,
			cdn: false,
			headers: null,
		});

		await archive.setResourcesReferrers({
			url: 'https://example.com/a',
			src: 'https://example.com/style-a.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/a',
			src: 'https://example.com/shared.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/a',
			src: 'https://example.com/app.js',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/b',
			src: 'https://example.com/style-a.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/b',
			src: 'https://example.com/shared.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/c',
			src: 'https://example.com/shared.css',
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('ページが参照するCSS URLの一覧を返す', async () => {
		const result = await collectPageStylesheetUrls(archive);

		expect(new Set(result.get('https://example.com/a'))).toEqual(
			new Set(['https://example.com/style-a.css', 'https://example.com/shared.css']),
		);
	});

	it('CSS以外のリソース（JS）は含まれない', async () => {
		const result = await collectPageStylesheetUrls(archive);

		expect(result.get('https://example.com/a')).not.toContain(
			'https://example.com/app.js',
		);
	});

	it('CSSを参照しないページはキーを持たない', async () => {
		const result = await collectPageStylesheetUrls(archive);

		expect(result.has('https://example.com/d')).toBe(false);
	});

	it('同一CSSセットを持つページ同士は同一の配列インスタンスを共有する（intern）', async () => {
		const result = await collectPageStylesheetUrls(archive);

		const a = result.get('https://example.com/a');
		const b = result.get('https://example.com/b');
		expect(a).toBeDefined();
		expect(a).toBe(b);
	});

	it('CSSセットが異なるページは別の配列インスタンスを持つ', async () => {
		const result = await collectPageStylesheetUrls(archive);

		const a = result.get('https://example.com/a');
		const c = result.get('https://example.com/c');
		expect(a).not.toBe(c);
		expect(c).toEqual(['https://example.com/shared.css']);
	});
});
