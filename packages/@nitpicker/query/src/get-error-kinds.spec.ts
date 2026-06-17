import type { CrawlerError } from '@nitpicker/crawler';

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
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

	it('classifies and aggregates page_errors + crawl_errors, sourced from crawl_errors', async () => {
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

		const result = await getErrorKinds(archive);

		expect(result.channelSource).toBe('crawl_errors');
		expect(result.total).toBe(3);

		const byKind = new Map(result.groups.map((g) => [g.kind, g]));
		expect(byKind.get('timeout')?.count).toBe(1);
		expect(byKind.get('timeout')?.hosts).toEqual([{ host: 'example.com', count: 1 }]);
		expect(byKind.get('dns')?.count).toBe(1);
		expect(byKind.get('dns')?.hosts).toEqual([{ host: 'ext.example.net', count: 1 }]);
		expect(byKind.get('dns')?.sampleUrls).toEqual(['http://ext.example.net/x']);
		expect(byKind.get('connection-refused')?.count).toBe(1);
	});

	it('groups are sorted by count, most failures first', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'sorted.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		await archive.addError(crawlerError('https://a.example.com/', 'Race 180,000ms'));
		await archive.addError(
			crawlerError('https://b.example.com/', 'Navigation timeout of 60000 ms exceeded'),
		);
		await archive.addError(
			crawlerError('https://c.example.net/', 'getaddrinfo ENOTFOUND c.example.net'),
		);

		const result = await getErrorKinds(archive);

		expect(result.groups[0]!.kind).toBe('timeout');
		expect(result.groups[0]!.count).toBe(2);
		expect(result.groups[1]!.kind).toBe('dns');
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

		expect(result.channelSource).toBe('error.log');
		const byKind = new Map(result.groups.map((g) => [g.kind, g]));
		expect(byKind.get('dns')?.count).toBe(1);
		expect(byKind.get('dns')?.hosts).toEqual([{ host: 'dead.example.net', count: 1 }]);
		// A process-level error logged with a `null` URL buckets under (unknown).
		expect(byKind.get('connection-reset')?.count).toBe(1);
		expect(byKind.get('connection-reset')?.hosts).toEqual([
			{ host: '(unknown)', count: 1 },
		]);
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

		expect(result.channelSource).toBe('error.log');
		expect(result.total).toBe(1);
		expect(result.groups[0]!.kind).toBe('dns');
	});

	it('reports channelSource none and empty groups for a clean archive', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'clean.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		const result = await getErrorKinds(archive);

		expect(result.total).toBe(0);
		expect(result.channelSource).toBe('none');
		expect(result.groups).toEqual([]);
	});
});
