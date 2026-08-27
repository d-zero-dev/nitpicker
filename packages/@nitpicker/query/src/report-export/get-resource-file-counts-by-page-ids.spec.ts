import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getResourceFileCountsByPageIds } from './get-resource-file-counts-by-page-ids.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_get_resource_file_counts_by_page_ids__',
);

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

const HOME = 'https://example.com/home';
const ABOUT = 'https://example.com/about';
const PLAIN = 'https://example.com/plain';

const STYLE = 'https://example.com/style.css';
const MOVED = 'https://example.com/moved.css';
const EDGE = 'https://example.com/edge.css';
const TOO_HIGH = 'https://example.com/too-high.css';
const MISSING = 'https://example.com/missing.png';
const BROKEN = 'https://example.com/broken.js';

describe('getResourceFileCountsByPageIds', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'get-resource-file-counts-by-page-ids-test.nitpicker',
	);
	const pageIds = new Map<string, number>();

	/**
	 * Stores one internal HTML page in the fixture archive.
	 * @param url - The page's absolute URL.
	 */
	async function setPage(url: string): Promise<void> {
		await archive.setPage({
			url: parseUrl(url)!,
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
	}

	/**
	 * Stores one sub-resource in the fixture archive.
	 * @param resource - The resource's URL, fetch status and `Content-Type`.
	 * @param resource.url
	 * @param resource.status
	 * @param resource.contentType
	 */
	async function setResource(resource: {
		url: string;
		status: number;
		contentType: string;
	}): Promise<void> {
		await archive.setResources({
			url: parseUrl(resource.url)!,
			isExternal: false,
			isError: resource.status >= 400,
			status: resource.status,
			statusText: 'Recorded',
			contentType: resource.contentType,
			contentLength: 1000,
			compress: false,
			cdn: false,
			headers: null,
		});
	}

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await setPage(HOME);
		await setPage(ABOUT);
		await setPage(PLAIN);

		await setResource({ url: STYLE, status: 200, contentType: 'text/css' });
		await setResource({ url: MOVED, status: 301, contentType: 'text/css' });
		await setResource({ url: EDGE, status: 399, contentType: 'text/css' });
		await setResource({ url: TOO_HIGH, status: 400, contentType: 'text/css' });
		await setResource({ url: MISSING, status: 404, contentType: 'image/png' });
		await setResource({
			url: BROKEN,
			status: 500,
			contentType: 'application/javascript',
		});

		await archive.setResourcesReferrers({ url: HOME, src: STYLE });
		await archive.setResourcesReferrers({ url: HOME, src: MOVED });
		await archive.setResourcesReferrers({ url: HOME, src: EDGE });
		await archive.setResourcesReferrers({ url: HOME, src: TOO_HIGH });
		await archive.setResourcesReferrers({ url: HOME, src: MISSING });
		await archive.setResourcesReferrers({ url: HOME, src: BROKEN });
		await archive.setResourcesReferrers({ url: ABOUT, src: STYLE });

		const knex = archive.getKnex();
		const rows: { id: number; url: string }[] = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.whereIn('ur.url', [HOME, ABOUT, PLAIN])
			.select('ci.id as id', 'ur.url as url');
		for (const row of rows) {
			pageIds.set(row.url, row.id);
		}
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty map for an empty page id list without querying', async () => {
		const counts = await getResourceFileCountsByPageIds(archive, []);
		expect(counts.size).toBe(0);
	});

	it('counts every referenced resource as total and only 200..399 as exists', async () => {
		const counts = await getResourceFileCountsByPageIds(archive, [pageIds.get(HOME)!]);
		expect(counts.get(pageIds.get(HOME)!)).toEqual({ total: 6, exists: 3 });
	});

	it('counts each page separately in one batch', async () => {
		const counts = await getResourceFileCountsByPageIds(archive, [
			pageIds.get(HOME)!,
			pageIds.get(ABOUT)!,
		]);
		expect(counts.get(pageIds.get(HOME)!)).toEqual({ total: 6, exists: 3 });
		expect(counts.get(pageIds.get(ABOUT)!)).toEqual({ total: 1, exists: 1 });
	});

	it('returns no entry for a page that references no resource', async () => {
		const counts = await getResourceFileCountsByPageIds(archive, [pageIds.get(PLAIN)!]);
		expect(counts.has(pageIds.get(PLAIN)!)).toBe(false);
	});

	it('ignores page ids that are not in the archive', async () => {
		const counts = await getResourceFileCountsByPageIds(archive, [999_999]);
		expect(counts.size).toBe(0);
	});
});
