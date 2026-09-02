import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { matchUrlList } from './match-url-list.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
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
};

const META = {
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
};

describe('matchUrlList', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_match_url_list__');
	const archiveFilePath = path.resolve(workingDir, 'match-url-list-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

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
			html: '',
			meta: { ...META, title: 'Page' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/target')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Target' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setRedirect({
			url: parseUrl('https://example.com/old')!,
			redirectPaths: ['https://example.com/target'],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setSkippedPage('https://example.com/blocked', 'excluded');
		await archive.setExternalPage({
			url: parseUrl('https://external.example.com/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('reports found: true with page details for an archived page', async () => {
		const [result] = await matchUrlList(archive, ['https://example.com/page']);
		expect(result).toMatchObject({
			url: 'https://example.com/page',
			normalizedUrl: 'https://example.com/page',
			found: true,
			status: 200,
			title: 'Page',
			isExternal: false,
			isSkipped: false,
		});
	});

	it('reports found: false, with all other fields null, for a URL never seen in the archive', async () => {
		const [result] = await matchUrlList(archive, ['https://example.com/missing']);
		expect(result).toEqual({
			url: 'https://example.com/missing',
			normalizedUrl: 'https://example.com/missing',
			found: false,
			pageId: null,
			status: null,
			statusText: null,
			contentType: null,
			title: null,
			isExternal: null,
			isSkipped: null,
			skipReason: null,
			firstCrawledAt: null,
			lastCrawledAt: null,
			redirectDestUrl: null,
		});
	});

	it('resolves the redirect source to its final destination URL', async () => {
		const [result] = await matchUrlList(archive, ['https://example.com/old']);
		expect(result).toMatchObject({
			found: true,
			redirectDestUrl: 'https://example.com/target',
		});
	});

	it('reports isSkipped and skipReason for an intentionally skipped URL', async () => {
		const [result] = await matchUrlList(archive, ['https://example.com/blocked']);
		expect(result).toMatchObject({
			found: true,
			isSkipped: true,
			skipReason: 'excluded',
		});
	});

	it('reports isExternal for an external page row', async () => {
		const [result] = await matchUrlList(archive, ['https://external.example.com/']);
		expect(result).toMatchObject({
			found: true,
			isExternal: true,
		});
	});

	it('reports found: false with a null normalizedUrl for an unparseable/non-HTTP URL', async () => {
		const [result] = await matchUrlList(archive, ['not a url']);
		expect(result).toEqual({
			url: 'not a url',
			normalizedUrl: null,
			found: false,
			pageId: null,
			status: null,
			statusText: null,
			contentType: null,
			title: null,
			isExternal: null,
			isSkipped: null,
			skipReason: null,
			firstCrawledAt: null,
			lastCrawledAt: null,
			redirectDestUrl: null,
		});
	});

	it('preserves input order, including duplicate entries', async () => {
		const results = await matchUrlList(archive, [
			'https://example.com/target',
			'https://example.com/page',
			'https://example.com/target',
		]);
		expect(results.map((r) => r.url)).toEqual([
			'https://example.com/target',
			'https://example.com/page',
			'https://example.com/target',
		]);
		expect(results[0]!.found).toBe(true);
		expect(results[2]!.found).toBe(true);
	});

	it('returns an empty array for an empty input list', async () => {
		await expect(matchUrlList(archive, [])).resolves.toEqual([]);
	});
});
