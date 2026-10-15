import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import Archive from '@nitpicker/archive/archive';
import { afterEach, describe, expect, it } from 'vitest';

import { sortArchiveUrls } from './sort-archive-urls.js';
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
		version: '0.13.0',
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
	afterEach(async () => {
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('ranks pages and resources URLs in natural sort order, deduplicated', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
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

	it('ranks URLs a pairwise numeric comparison could not order, densely and in a total order', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'total-order.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		for (const name of ['a10', 'a9', 'a1x', 'index-j.html', 'index.html', '']) {
			await addPage(archive, `https://example.com/${name}`);
		}

		await prepareUrlSortTempTable(archive);

		const rows = await archive
			.getKnex()(URL_SORT_TEMP_TABLE)
			.select('url', 'rank')
			.orderBy('rank', 'asc');
		expect(rows).toEqual([
			{ url: 'https://example.com', rank: 0 },
			{ url: 'https://example.com/index.html', rank: 1 },
			{ url: 'https://example.com/index-j.html', rank: 2 },
			{ url: 'https://example.com/a1x', rank: 3 },
			{ url: 'https://example.com/a9', rank: 4 },
			{ url: 'https://example.com/a10', rank: 5 },
		]);
	});

	it('ranks the URLs of every chunk of a multi-chunk read together', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'chunks.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		for (const n of [30, 4, 21, 7, 13, 2]) {
			await addPage(archive, `https://example.com/p${n}`);
		}

		const ranked: string[] = [];
		await sortArchiveUrls(
			archive,
			(url) => {
				ranked.push(url);
				return Promise.resolve();
			},
			{ readChunkSize: 2 },
		);

		expect(ranked).toEqual([2, 4, 7, 13, 21, 30].map((n) => `https://example.com/p${n}`));
	});

	it('emits nothing and still reports completion for an archive without URLs', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'empty.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		const ranked: string[] = [];
		const messages: string[] = [];
		await sortArchiveUrls(
			archive,
			(url) => {
				ranked.push(url);
				return Promise.resolve();
			},
			{ onProgress: (message) => messages.push(message) },
		);

		expect(ranked).toEqual([]);
		expect(messages.at(-1)).toBe('Sorting URLs: done — 0 distinct URLs ranked');
	});

	it('orderByUrlRank sorts a query by natural URL order via the temp table', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'order.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		await addPage(archive, 'https://example.com/image-10.jpg');
		await addPage(archive, 'https://example.com/image-2.jpg');

		await prepareUrlSortTempTable(archive);
		const knex = archive.getKnex();
		const rows = await orderByUrlRank(
			knex('content_items as ci')
				.join('url_refs as ur', 'ur.id', 'ci.url_id')
				.select('ur.url as url'),
			knex,
			'"ur"."url"',
		);
		expect(rows.map((r: { url: string }) => r.url)).toEqual([
			'https://example.com/image-2.jpg',
			'https://example.com/image-10.jpg',
		]);
	});

	it('survives a duplicate URL insert against the already-prepared table without throwing', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'dup-insert.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/page');

		await prepareUrlSortTempTable(archive);

		// The insert in `prepareUrlSortTempTable` carries `onConflict('url').ignore()`
		// as a fail-safe: ranking emits each distinct URL once, so a conflict is
		// not expected, but if one ever reached it, it must be a no-op and not a
		// `UNIQUE constraint failed` crash. This exercises the exact insert shape
		// against the exact table it built.
		const knex = archive.getKnex();
		const existing = await knex(URL_SORT_TEMP_TABLE).select('url', 'rank').first();
		await expect(
			knex(URL_SORT_TEMP_TABLE)
				.insert([{ url: existing.url, rank: existing.rank + 999 }])
				.onConflict('url')
				.ignore(),
		).resolves.not.toThrow();

		const row = await knex(URL_SORT_TEMP_TABLE).where({ url: existing.url }).first();
		expect(row.rank).toBe(existing.rank);
	});

	it('ensureUrlSortTempTable only prepares the table once per connection', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
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

	it('ensureUrlSortTempTable shares one preparation between concurrent first calls', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'ensure-concurrent.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/a');
		await addPage(archive, 'https://example.com/b');

		const first: string[] = [];
		const second: string[] = [];
		await Promise.all([
			ensureUrlSortTempTable(archive, (message) => first.push(message)),
			ensureUrlSortTempTable(archive, (message) => second.push(message)),
		]);

		// Only the call that started the preparation reports its progress; the
		// other waits for it instead of running a second sort.
		expect(first.length).toBeGreaterThan(0);
		expect(second).toEqual([]);
		const rows = await archive.getKnex()(URL_SORT_TEMP_TABLE).select('url');
		expect(rows).toHaveLength(2);
	});

	it('ensureUrlSortTempTable forwards onProgress to prepareUrlSortTempTable on a cold connection (issue #294)', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'ensure-progress.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/');

		const messages: string[] = [];
		await ensureUrlSortTempTable(archive, (message) => messages.push(message));

		expect(messages.length).toBeGreaterThan(0);
	});

	it('ensureUrlSortTempTable does not call onProgress on an already-prepared connection', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'ensure-warm.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/');

		await ensureUrlSortTempTable(archive);
		const messages: string[] = [];
		await ensureUrlSortTempTable(archive, (message) => messages.push(message));

		expect(messages).toEqual([]);
	});
});
