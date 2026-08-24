import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRedirectFromUrlsByDestId } from './build-redirect-from-urls-by-dest-id.js';

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

describe('buildRedirectFromUrlsByDestId', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_build_redirect_from_urls_by_dest_id__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'build-redirect-from-urls-by-dest-id-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;
	let targetId: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

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
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setRedirect({
			url: parseUrl('https://example.com/old-1')!,
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
		await archive.setRedirect({
			url: parseUrl('https://example.com/old-2')!,
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
		await archive.setPage({
			url: parseUrl('https://example.com/no-redirects')!,
			redirectPaths: [],
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

		const knex = archive.getKnex();
		const targetRow = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/target')
			.first();
		targetId = targetRow.id;
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('lists every redirect source URL for a destination', async () => {
		const map = await buildRedirectFromUrlsByDestId(archive);
		const urls = map.get(targetId)!;
		expect(urls).toHaveLength(2);
		expect(urls).toEqual(
			expect.arrayContaining(['https://example.com/old-1', 'https://example.com/old-2']),
		);
	});

	it('has no entry for a page nothing redirects to', async () => {
		const map = await buildRedirectFromUrlsByDestId(archive);
		const knex = archive.getKnex();
		const noRedirectsRow = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/no-redirects')
			.first();
		expect(map.has(noRedirectsRow.id)).toBe(false);
	});
});
