import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolvePageIdsByUrls } from './resolve-page-ids-by-urls.js';

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

describe('resolvePageIdsByUrls', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_resolve_page_ids_by_urls__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'resolve-page-ids-by-urls-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'A' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'B' },
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

	it('returns an empty map for an empty url list without querying', async () => {
		const result = await resolvePageIdsByUrls(archive, []);
		expect(result.size).toBe(0);
	});

	it('resolves every requested URL to its content_items.id', async () => {
		const result = await resolvePageIdsByUrls(archive, [
			'https://example.com/a',
			'https://example.com/b',
		]);
		expect(result.size).toBe(2);
		expect(result.has('https://example.com/a')).toBe(true);
		expect(result.has('https://example.com/b')).toBe(true);
	});

	it('omits a URL with no matching page', async () => {
		const result = await resolvePageIdsByUrls(archive, [
			'https://example.com/a',
			'https://example.com/does-not-exist',
		]);
		expect(result.has('https://example.com/does-not-exist')).toBe(false);
		expect(result.has('https://example.com/a')).toBe(true);
	});
});
