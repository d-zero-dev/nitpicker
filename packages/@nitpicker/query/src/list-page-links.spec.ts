import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listPageLinks } from './list-page-links.js';

const dirname = path.dirname(new URL(import.meta.url).pathname);
const workingDir = path.resolve(dirname, '__test_fixtures_page_links__');

/** Default page metadata for fixture pages. */
const META = {
	lang: 'ja',
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
};

describe('listPageLinks', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'page-links-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
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

		// Home (with response headers) links to About.
		await archive.setPage({
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: { 'content-type': 'text/html' },
			html: '<html></html>',
			meta: { ...META, title: 'Home' },
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// About (no response headers) links back to Home.
		await archive.setPage({
			url: parseUrl('https://example.com/about')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'About' },
			anchorList: [
				{
					href: parseUrl('https://example.com/')!,
					isExternal: false,
					title: null,
					textContent: 'Home',
				},
			],
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

	it('全ページを1行ずつ返す', async () => {
		const result = await listPageLinks(archive);
		expect(result.total).toBeGreaterThanOrEqual(2);
		expect(result.items.length).toBeGreaterThanOrEqual(2);
	});

	it('被リンク数 (referrerCount) を計算する', async () => {
		const result = await listPageLinks(archive);
		const about = result.items.find((i) => i.url === 'https://example.com/about');
		expect(about?.referrerCount).toBe(1);
	});

	it('レスポンスヘッダの有無を返す', async () => {
		const result = await listPageLinks(archive);
		const home = result.items.find((i) => i.url === 'https://example.com');
		const about = result.items.find((i) => i.url === 'https://example.com/about');
		expect(home?.hasResponseHeaders).toBe(true);
		expect(about?.hasResponseHeaders).toBe(false);
	});

	it('precomputedReferrerCounts を渡すと SQL 経由ではなく Map lookup で referrerCount を埋める', async () => {
		// The viewer-side precompute path: `listPageLinks` should pick
		// the Map value, not the per-row correlated subquery. We force
		// a deliberately wrong Map so a passing test proves the Map was
		// consulted (if SQL fallback were used, we'd see the real count
		// of 1 against About, not the 42 we inject).
		const result = await listPageLinks(archive);
		const about = result.items.find((i) => i.url === 'https://example.com/about');
		expect(about).toBeDefined();
		// Re-fetch IDs via the same SELECT shape used by listPageLinks
		// so the test does not couple to internal schema layout.
		const rows = (await archive
			.getKnex()
			.from('pages')
			.select('id', 'url')
			.whereNull('redirectDestId')) as Array<{ id: number; url: string }>;
		const aboutId = rows.find((r) => r.url === 'https://example.com/about')?.id;
		expect(aboutId).toBeDefined();

		const precomputedReferrerCounts = new Map<number, number>([[aboutId!, 42]]);
		const result2 = await listPageLinks(archive, { precomputedReferrerCounts });
		const about2 = result2.items.find((i) => i.url === 'https://example.com/about');
		expect(about2?.referrerCount).toBe(42);

		// Pages missing from the map default to 0 (matches the
		// "GROUP BY anchors" shape — pages with zero inbound anchors
		// are absent from the aggregate output).
		const home2 = result2.items.find((i) => i.url === 'https://example.com');
		expect(home2?.referrerCount).toBe(0);
	});
});

describe('listPageLinks: referrerCount を redirect 越しに合算する（http/https, #71）', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(dirname, '__test_fixtures_page_links_redirect__');
	const archiveFilePath = path.resolve(dir, 'page-links-redirect.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
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

		// Canonical https destination.
		await archive.setPage({
			url: parseUrl('https://example.com/page')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Page' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// http source 301-ing to the https destination.
		await archive.setPage({
			url: parseUrl('http://example.com/page')!,
			redirectPaths: ['https://example.com/page'],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// One page links the https destination directly, another links the http source.
		await archive.setPage({
			url: parseUrl('https://example.com/linker-https')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META },
			anchorList: [
				{
					href: parseUrl('https://example.com/page')!,
					isExternal: false,
					title: null,
					textContent: 'direct https',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/linker-http')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META },
			anchorList: [
				{
					href: parseUrl('http://example.com/page')!,
					isExternal: false,
					title: null,
					textContent: 'via http',
				},
			],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('http リンクと https リンクの両方が宛先の referrerCount に合算される', async () => {
		const result = await listPageLinks(archive);
		const page = result.items.find((i) => i.url === 'https://example.com/page');
		// 直リンク(https) + redirect 元(http)へのリンク = 2 が宛先に集約される（分裂しない）。
		expect(page?.referrerCount).toBe(2);
	});
});
