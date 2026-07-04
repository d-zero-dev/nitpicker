import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterEach, describe, expect, it } from 'vitest';

import {
	ensureUrlSortTempTable,
	orderByUrlRank,
	prepareUrlSortTempTable,
	URL_SORT_TEMP_TABLE,
} from './url-sort-temp-table.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_url_sort_temp_table__');

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

/**
 * Minimal config so {@link Archive.create} has a valid `info` row.
 * @returns A config object accepted by `Archive.setConfig`.
 */
function baseConfig() {
	return {
		baseUrl: 'https://example.com',
		name: 'test',
		version: '0.10.0',
		recursive: true,
		interval: 0,
		image: false,
		fetchExternal: true,
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
}

/**
 * Adds a minimal internal HTML page to the archive.
 * @param archive - The archive to write to.
 * @param url - The page URL.
 */
async function addPage(archive: InstanceType<typeof Archive>, url: string) {
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

describe('prepareUrlSortTempTable / ensureUrlSortTempTable / orderByUrlRank', () => {
	let archive: InstanceType<typeof Archive> | undefined;

	afterEach(async () => {
		if (archive) {
			await archive.close();
			archive = undefined;
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('ranks pages and resources URLs in natural sort order, deduplicated', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'rank.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		await addPage(archive, 'https://example.com/image-10.jpg');
		await addPage(archive, 'https://example.com/image-2.jpg');
		// Same URL as a page above — must be deduplicated to one ranked row,
		// not appear twice or shift the other ranks.
		await archive.setResources({
			url: parseUrl('https://example.com/image-2.jpg')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'image/jpeg',
			contentLength: 500,
			compress: false,
			cdn: false,
			headers: null,
		});

		await prepareUrlSortTempTable(archive);

		const rows = await archive
			.getKnex()(URL_SORT_TEMP_TABLE)
			.select('url', 'rank')
			.orderBy('rank', 'asc');
		expect(rows).toEqual([
			{ url: 'https://example.com/image-2.jpg', rank: 0 },
			{ url: 'https://example.com/image-10.jpg', rank: 1 },
		]);
	});

	it('orderByUrlRank sorts a query by natural URL order via the temp table', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'order.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		await addPage(archive, 'https://example.com/image-10.jpg');
		await addPage(archive, 'https://example.com/image-2.jpg');

		await prepareUrlSortTempTable(archive);
		const knex = archive.getKnex();
		const rows = await orderByUrlRank(knex('pages').select('url'), knex, '"pages"."url"');
		expect(rows.map((r: { url: string }) => r.url)).toEqual([
			'https://example.com/image-2.jpg',
			'https://example.com/image-10.jpg',
		]);
	});

	it('ensureUrlSortTempTable only prepares the table once per connection', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'ensure.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/');

		await ensureUrlSortTempTable(archive);
		// A page added after the first prepare must NOT appear once the
		// connection is already marked prepared — otherwise every list query
		// would silently re-pay the full scan-and-sort cost on every call.
		await addPage(archive, 'https://example.com/late');
		await ensureUrlSortTempTable(archive);

		const rows = await archive.getKnex()(URL_SORT_TEMP_TABLE).select('url');
		expect(rows.map((r: { url: string }) => r.url)).toEqual(['https://example.com']);
	});
});
