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

		// Reproduces the crash observed on an 11 GB / ~1.5M-URL archive: the
		// natural-sort comparator behind the external merge sort
		// (`@d-zero/shared`'s `numericalComparator`) is not guaranteed
		// transitive, which can occasionally let the same URL reach this
		// insert twice with different ranks. `onConflict('url').ignore()` in
		// `prepareUrlSortTempTable` must turn that into a no-op, not a
		// `UNIQUE constraint failed` crash — this exercises the exact insert
		// shape it uses against the exact table it built.
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

	it('onRanked reports every row externalSortUrls ranks, in the same order as the insert', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'on-ranked.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/image-10.jpg');
		await addPage(archive, 'https://example.com/image-2.jpg');

		const ranked: { url: string; rank: number }[] = [];
		await prepareUrlSortTempTable(archive, {
			onRanked: (url, rank) => ranked.push({ url, rank }),
		});

		expect(ranked).toEqual([
			{ url: 'https://example.com/image-2.jpg', rank: 0 },
			{ url: 'https://example.com/image-10.jpg', rank: 1 },
		]);
	});

	it('rankedUrls replays a caller-supplied source instead of running externalSortUrls', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'ranked-urls-source.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		// Not sorted, and not even a real URL under this archive — proves the
		// replay path trusts the supplied source verbatim rather than falling
		// back to (or cross-checking against) `pages`/`resources`.
		/**
		 * Fixture ranked-URL source. Must be an async generator to satisfy
		 * `rankedUrls: AsyncIterable<...>`, even though the fixture data is
		 * available synchronously.
		 * @yields {{url: string, rank: number}} A fixed, out-of-natural-order pair.
		 */
		// eslint-disable-next-line @typescript-eslint/require-await -- async generator required by the AsyncIterable type; fixture body is synchronous.
		async function* source() {
			yield { url: 'https://cached.example.com/b', rank: 0 };
			yield { url: 'https://cached.example.com/a', rank: 1 };
		}

		await prepareUrlSortTempTable(archive, { rankedUrls: source() });

		const rows = await archive
			.getKnex()(URL_SORT_TEMP_TABLE)
			.select('url', 'rank')
			.orderBy('rank', 'asc');
		expect(rows).toEqual([
			{ url: 'https://cached.example.com/b', rank: 0 },
			{ url: 'https://cached.example.com/a', rank: 1 },
		]);
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
