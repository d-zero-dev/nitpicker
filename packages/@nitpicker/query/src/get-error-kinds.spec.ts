import type { CrawlerError } from '@nitpicker/crawler';

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Archive, populateMigrationTables } from '@nitpicker/crawler';
import { afterEach, describe, expect, it } from 'vitest';

import { getErrorKinds } from './get-error-kinds.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_error_kinds__');

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
 * Build a `CrawlerError` for the crawler-level `error` channel.
 * @param url - The URL the error is about, or `null` for a process-level error.
 * @param message - The raw error message.
 * @param isExternal - Whether the URL is external.
 * @returns A `CrawlerError` accepted by `Archive.addError`.
 */
function crawlerError(
	url: string | null,
	message: string,
	isExternal = false,
): CrawlerError {
	return { pid: 1, isMainProcess: true, url, isExternal, error: new Error(message) };
}

describe('getErrorKinds', () => {
	let archive: InstanceType<typeof Archive> | undefined;

	afterEach(async () => {
		if (archive) {
			await archive.close();
			archive = undefined;
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('classifies and aggregates page_errors + crawl_errors into host×kind rows, sourced from crawl_errors', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'capture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		// Scrape-path failure → page_errors (timeout).
		await archive.addPageError(
			'https://example.com/slow',
			'retryExhausted',
			'gave up after 3 retries — Race 180,000ms vs Scraper.#fetchData',
			false,
		);
		// Crawler-level failures → crawl_errors (dns + connection-refused).
		await archive.addError(
			crawlerError(
				'http://ext.example.net/x',
				'getaddrinfo ENOTFOUND ext.example.net',
				true,
			),
		);
		await archive.addError(
			crawlerError('https://api.example.org/', 'connect ECONNREFUSED 10.0.0.1:443', true),
		);
		await populateMigrationTables(archive);

		const result = await getErrorKinds(archive);

		expect(result.facets.channelSource).toBe('crawl_errors');
		expect(result.facets.totalRecords).toBe(3);
		expect(result.total).toBe(3);

		const byKey = new Map(
			result.items.map((item) => [`${item.host} ${item.kind}`, item]),
		);
		expect(byKey.get('example.com timeout')?.count).toBe(1);
		expect(byKey.get('ext.example.net dns')?.count).toBe(1);
		expect(byKey.get('ext.example.net dns')?.sampleUrls).toEqual([
			'http://ext.example.net/x',
		]);
		expect(byKey.get('ext.example.net dns')?.overflowedCount).toBe(0);
		expect(byKey.get('api.example.org connection-refused')?.count).toBe(1);
	});

	it('normalizes to one row per host×kind pair — a host failing with two causes yields two rows', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'multi-kind-host.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		// Same host, two different retry attempts classifying to different kinds.
		await archive.addError(
			crawlerError(
				'https://flaky.example.com/',
				'getaddrinfo ENOTFOUND flaky.example.com',
			),
		);
		await archive.addError(
			crawlerError(
				'https://flaky.example.com/',
				'Navigation timeout of 60000 ms exceeded',
			),
		);

		const result = await getErrorKinds(archive);

		expect(result.total).toBe(2);
		const kinds = result.items
			.filter((item) => item.host === 'flaky.example.com')
			.map((item) => item.kind)
			.toSorted();
		expect(kinds).toEqual(['dns', 'timeout']);
	});

	it('items are sorted by count desc by default', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'sorted.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		await archive.addError(crawlerError('https://a.example.com/', 'Race 180,000ms'));
		await archive.addError(
			crawlerError('https://a.example.com/', 'Navigation timeout of 60000 ms exceeded'),
		);
		await archive.addError(
			crawlerError('https://c.example.net/', 'getaddrinfo ENOTFOUND c.example.net'),
		);

		const result = await getErrorKinds(archive);

		expect(result.items[0]!.host).toBe('a.example.com');
		expect(result.items[0]!.kind).toBe('timeout');
		expect(result.items[0]!.count).toBe(2);
		expect(result.items[1]!.kind).toBe('dns');
	});

	it('filters by exact host and kind', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'filter.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		await archive.addError(
			crawlerError('https://a.example.com/', 'getaddrinfo ENOTFOUND a.example.com'),
		);
		await archive.addError(
			crawlerError('https://b.example.com/', 'Navigation timeout of 60000 ms exceeded'),
		);

		const byHost = await getErrorKinds(archive, { host: 'a.example.com' });
		expect(byHost.items).toHaveLength(1);
		expect(byHost.items[0]!.host).toBe('a.example.com');
		expect(byHost.facets.totalRecords).toBe(2);

		const byKind = await getErrorKinds(archive, { kind: 'timeout' });
		expect(byKind.items).toHaveLength(1);
		expect(byKind.items[0]!.host).toBe('b.example.com');

		const byBoth = await getErrorKinds(archive, {
			host: 'a.example.com',
			kind: 'dns',
		});
		expect(byBoth.items).toHaveLength(1);

		const byMismatch = await getErrorKinds(archive, {
			host: 'a.example.com',
			kind: 'timeout',
		});
		expect(byMismatch.items).toHaveLength(0);
	});

	it('falls back to count-desc when sortBy is not a recognized field', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'bad-sortby.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		await archive.addError(crawlerError('https://a.example.com/', 'Race 180,000ms'));
		await archive.addError(
			crawlerError('https://a.example.com/', 'Navigation timeout of 60000 ms exceeded'),
		);
		await archive.addError(
			crawlerError('https://c.example.net/', 'getaddrinfo ENOTFOUND c.example.net'),
		);

		// An unvalidated `?sortBy=` from a hand-edited URL or stray API call
		// must not reach `sortArrayItems` with a key its config doesn't define.
		const result = await getErrorKinds(archive, {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulating an out-of-range value from an untyped caller (e.g. a raw query string).
			sortBy: 'bogus' as any,
		});

		expect(result.items[0]!.kind).toBe('timeout');
		expect(result.items[0]!.count).toBe(2);
	});

	it('sorts by host and kind in either direction', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'sort-fields.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		await archive.addError(
			crawlerError('https://b.example.com/', 'getaddrinfo ENOTFOUND b.example.com'),
		);
		await archive.addError(
			crawlerError('https://a.example.com/', 'getaddrinfo ENOTFOUND a.example.com'),
		);

		const ascByHost = await getErrorKinds(archive, { sortBy: 'host', sortOrder: 'asc' });
		expect(ascByHost.items.map((item) => item.host)).toEqual([
			'a.example.com',
			'b.example.com',
		]);

		const descByHost = await getErrorKinds(archive, {
			sortBy: 'host',
			sortOrder: 'desc',
		});
		expect(descByHost.items.map((item) => item.host)).toEqual([
			'b.example.com',
			'a.example.com',
		]);
	});

	it('paginates with limit/offset, and returns every row when limit is omitted', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'pagination.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		for (const host of ['a', 'b', 'c']) {
			await archive.addError(
				crawlerError(
					`https://${host}.example.com/`,
					`getaddrinfo ENOTFOUND ${host}.example.com`,
				),
			);
		}

		const all = await getErrorKinds(archive, { sortBy: 'host', sortOrder: 'asc' });
		expect(all.items).toHaveLength(3);
		expect(all.total).toBe(3);

		const page = await getErrorKinds(archive, {
			sortBy: 'host',
			sortOrder: 'asc',
			limit: 1,
			offset: 1,
		});
		expect(page.items).toHaveLength(1);
		expect(page.items[0]!.host).toBe('b.example.com');
		expect(page.total).toBe(3);
	});

	it('caps sample URLs per host×kind pair and tracks overflow beyond the cap', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'overflow.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		// Exactly at the cap (50): no overflow.
		for (let i = 0; i < 50; i++) {
			await archive.addError(
				crawlerError(
					`https://capped.example.com/page-${i}`,
					'getaddrinfo ENOTFOUND capped.example.com',
				),
			);
		}
		const atCap = await getErrorKinds(archive, { host: 'capped.example.com' });
		expect(atCap.items[0]!.sampleUrls).toHaveLength(50);
		expect(atCap.items[0]!.overflowedCount).toBe(0);
		expect(atCap.items[0]!.count).toBe(50);

		// One past the cap: overflowedCount reflects the dropped record.
		await archive.addError(
			crawlerError(
				'https://capped.example.com/page-50',
				'getaddrinfo ENOTFOUND capped.example.com',
			),
		);
		const overCap = await getErrorKinds(archive, { host: 'capped.example.com' });
		expect(overCap.items[0]!.sampleUrls).toHaveLength(50);
		expect(overCap.items[0]!.overflowedCount).toBe(1);
		expect(overCap.items[0]!.count).toBe(51);
	});

	it('falls back to parsing error.log when the crawl_errors table is absent', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'legacy.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		// Simulate an archive crawled before structured capture: drop the table
		// and leave only a text error.log (the format addError writes).
		await archive.getKnex().schema.dropTable('crawl_errors');
		await writeFile(
			path.join(archive.tmpDir, 'error.log'),
			[
				'[123(main)] http://dead.example.net/ Error: getaddrinfo ENOTFOUND dead.example.net',
				'    at node:dns:122:26',
				'[123(main)] null Error: socket hang up',
				'    at node:_http_client:526:25',
			].join('\n'),
			'utf8',
		);

		const result = await getErrorKinds(archive);

		expect(result.facets.channelSource).toBe('error.log');
		const byKey = new Map(
			result.items.map((item) => [`${item.host} ${item.kind}`, item]),
		);
		expect(byKey.get('dead.example.net dns')?.count).toBe(1);
		// A process-level error logged with a `null` URL buckets under (unknown).
		expect(byKey.get('(unknown) connection-reset')?.count).toBe(1);
	});

	it('falls back to error.log when crawl_errors exists but is empty (migrated legacy archive)', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'migrated.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		// The table exists (as a migration would leave it) but holds no rows,
		// while the legacy errors still live only in error.log.
		expect(await archive.getKnex().schema.hasTable('crawl_errors')).toBe(true);
		await writeFile(
			path.join(archive.tmpDir, 'error.log'),
			'[1(main)] http://dead.example.net/ Error: getaddrinfo ENOTFOUND dead.example.net\n',
			'utf8',
		);

		const result = await getErrorKinds(archive);

		expect(result.facets.channelSource).toBe('error.log');
		expect(result.facets.totalRecords).toBe(1);
		expect(result.items[0]!.kind).toBe('dns');
	});

	it('reports channelSource none and no items for a clean archive', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'clean.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		const result = await getErrorKinds(archive);

		expect(result.total).toBe(0);
		expect(result.facets.totalRecords).toBe(0);
		expect(result.facets.channelSource).toBe('none');
		expect(result.items).toEqual([]);
	});
});
