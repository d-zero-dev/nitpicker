import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getResourceReferrerUrlsByResourceIds } from './get-resource-referrer-urls-by-resource-ids.js';

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

describe('getResourceReferrerUrlsByResourceIds', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_get_resource_referrer_urls_by_resource_ids__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'get-resource-referrer-urls-by-resource-ids-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;
	let cssId: number;
	let jsId: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

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
			html: '',
			meta: { ...META, title: 'Home' },
			anchorList: [],
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
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'About' },
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
			compress: false,
			cdn: false,
			headers: null,
		});
		await archive.setResources({
			url: parseUrl('https://example.com/unused.js')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 500,
			compress: false,
			cdn: false,
			headers: null,
		});

		await archive.setResourcesReferrers({
			url: 'https://example.com',
			src: 'https://example.com/style.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/about',
			src: 'https://example.com/style.css',
		});

		const knex = archive.getKnex();
		const cssRow = await knex('resource_items as ri')
			.join('url_refs as ur', 'ur.id', 'ri.url_id')
			.select('ri.id as id')
			.where('ur.url', 'https://example.com/style.css')
			.first();
		cssId = cssRow.id;
		const jsRow = await knex('resource_items as ri')
			.join('url_refs as ur', 'ur.id', 'ri.url_id')
			.select('ri.id as id')
			.where('ur.url', 'https://example.com/unused.js')
			.first();
		jsId = jsRow.id;
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty map for an empty resource id list without querying', async () => {
		const result = await getResourceReferrerUrlsByResourceIds(archive, []);
		expect(result.size).toBe(0);
	});

	it('lists every referrer page URL for a resource', async () => {
		const result = await getResourceReferrerUrlsByResourceIds(archive, [cssId]);
		const urls = result.get(cssId)!;
		expect(urls).toHaveLength(2);
		expect(urls).toEqual(
			expect.arrayContaining(['https://example.com', 'https://example.com/about']),
		);
	});

	it('returns no entry for a resource with no referrers', async () => {
		const result = await getResourceReferrerUrlsByResourceIds(archive, [jsId]);
		expect(result.has(jsId)).toBe(false);
	});
});
