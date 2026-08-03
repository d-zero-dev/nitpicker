import type { CrawlerError } from '@nitpicker/crawler';

import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getErrorKinds } from './get-error-kinds.js';
import { getViewerErrorKinds } from './get-viewer-error-kinds.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

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

describe('getViewerErrorKinds', () => {
	describe('no read model built', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_get_viewer_error_kinds_no_model__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'no-model-test.nitpicker'),
				cwd: workingDir,
			});
			await archive.setConfig(baseConfig());
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('throws — callers must guard with isViewerReadModelCurrent() first', async () => {
			await expect(getViewerErrorKinds(archive)).rejects.toThrow(
				/viewer_error_kind_meta/,
			);
		});
	});

	describe('read model built, no failures recorded', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_get_viewer_error_kinds_clean__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'clean-test.nitpicker'),
				cwd: workingDir,
			});
			await archive.setConfig(baseConfig());
			await buildViewerReadModel(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns total 0, an empty items array, and facets totalRecords 0/channelSource "none" — the meta row exists even with zero failures', async () => {
			const result = await getViewerErrorKinds(archive);
			expect(result).toEqual({
				items: [],
				total: 0,
				facets: { totalRecords: 0, channelSource: 'none' },
			});
		});
	});

	describe('with read model built', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_get_viewer_error_kinds_built__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'built-test.nitpicker'),
				cwd: workingDir,
			});
			await archive.setConfig(baseConfig());

			await archive.addPageError(
				'https://example.com/slow',
				'retryExhausted',
				'gave up after 3 retries — Race 180,000ms vs Scraper.#fetchData',
				false,
			);
			await archive.addError(
				crawlerError(
					'http://ext.example.net/x',
					'getaddrinfo ENOTFOUND ext.example.net',
					true,
				),
			);
			await archive.addError(
				crawlerError(
					'http://ext.example.net/y',
					'getaddrinfo ENOTFOUND ext.example.net',
					true,
				),
			);
			await archive.addError(
				crawlerError(
					'https://api.example.org/',
					'connect ECONNREFUSED 10.0.0.1:443',
					true,
				),
			);

			await buildViewerReadModel(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('matches a getErrorKinds() (live) snapshot of the same archive', async () => {
			const [viewerResult, liveResult] = await Promise.all([
				getViewerErrorKinds(archive),
				getErrorKinds(archive),
			]);
			// Both sort by count descending, but neither documents a tie-break
			// rule for equal counts (live ties break by Map insertion order;
			// the read model ties break by host/kind ascending) — sort by
			// host+kind before comparing so the two equally-valid tie-break
			// orders don't fail an otherwise-matching comparison. This
			// fixture's two count=1 entries (api.example.org/connection-refused,
			// example.com/timeout) tie.
			const sortByHostKind = (r: typeof liveResult) => ({
				...r,
				items: r.items.toSorted(
					(a, b) => a.host.localeCompare(b.host) || a.kind.localeCompare(b.kind),
				),
			});
			expect(sortByHostKind(viewerResult)).toEqual(sortByHostKind(liveResult));
		});

		it("computes the fixture's counts/host breakdown independently of getErrorKinds() (hardcoded expectations)", async () => {
			const result = await getViewerErrorKinds(archive);
			expect(result.total).toBe(3);
			expect(result.facets).toEqual({ totalRecords: 4, channelSource: 'crawl_errors' });

			const byKey = new Map(
				result.items.map((item) => [`${item.host} ${item.kind}`, item]),
			);
			expect(byKey.get('ext.example.net dns')).toMatchObject({
				count: 2,
				sampleUrls: ['http://ext.example.net/x', 'http://ext.example.net/y'],
				overflowedCount: 0,
			});
			expect(byKey.get('api.example.org connection-refused')).toMatchObject({ count: 1 });
			expect(byKey.get('example.com timeout')).toMatchObject({ count: 1 });
		});

		it('orders items by count descending by default', async () => {
			const result = await getViewerErrorKinds(archive);
			expect(result.items[0]).toMatchObject({
				host: 'ext.example.net',
				kind: 'dns',
				count: 2,
			});
		});

		it('falls back to count-desc for an out-of-range sortBy, matching getErrorKinds() — regression test', async () => {
			// The default sortOrder must be derived from the clamped column
			// selection, not the raw, unvalidated sortBy — deriving it from the
			// raw value makes an invalid sortBy silently return count-ascending
			// instead of matching getErrorKinds()'s count-descending fallback.
			const [viewerResult, liveResult] = await Promise.all([
				getViewerErrorKinds(archive, {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulating an out-of-range value from an untyped caller.
					sortBy: 'bogus' as any,
				}),
				getErrorKinds(archive, {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulating an out-of-range value from an untyped caller.
					sortBy: 'bogus' as any,
				}),
			]);
			// The count=2 entry must sort first under either a correct 'desc'
			// default or an incorrect 'asc' one — assert the two count=1 ties
			// (which is where an 'asc' regression would actually surface: they'd
			// flip to the end) land last, sorted by host+kind for the same
			// tie-break-is-unspecified reason as the snapshot-match test above.
			const sortByHostKind = (r: typeof liveResult) => ({
				...r,
				items: r.items.toSorted(
					(a, b) => a.host.localeCompare(b.host) || a.kind.localeCompare(b.kind),
				),
			});
			expect(viewerResult.items[0]).toMatchObject({
				host: 'ext.example.net',
				kind: 'dns',
				count: 2,
			});
			expect(sortByHostKind(viewerResult)).toEqual(sortByHostKind(liveResult));
		});

		it('filters by exact host and kind, matching getErrorKinds()', async () => {
			const [viewerByHost, liveByHost] = await Promise.all([
				getViewerErrorKinds(archive, { host: 'ext.example.net' }),
				getErrorKinds(archive, { host: 'ext.example.net' }),
			]);
			expect(viewerByHost).toEqual(liveByHost);
			expect(viewerByHost.items).toHaveLength(1);
			// facets stay archive-wide, unaffected by the host filter.
			expect(viewerByHost.facets.totalRecords).toBe(4);

			const [viewerByKind, liveByKind] = await Promise.all([
				getViewerErrorKinds(archive, { kind: 'connection-refused' }),
				getErrorKinds(archive, { kind: 'connection-refused' }),
			]);
			expect(viewerByKind).toEqual(liveByKind);
			expect(viewerByKind.items).toHaveLength(1);

			const both = await getViewerErrorKinds(archive, {
				host: 'ext.example.net',
				kind: 'timeout',
			});
			expect(both.items).toEqual([]);
			expect(both.total).toBe(0);
		});

		it('filters by an array of kinds, OR-ing them together', async () => {
			const result = await getViewerErrorKinds(archive, {
				kind: ['connection-refused', 'timeout'],
			});
			const [connectionRefusedOnly, timeoutOnly] = await Promise.all([
				getViewerErrorKinds(archive, { kind: 'connection-refused' }),
				getViewerErrorKinds(archive, { kind: 'timeout' }),
			]);
			expect(result.items).toHaveLength(
				connectionRefusedOnly.items.length + timeoutOnly.items.length,
			);
		});

		it('sorts by host asc/desc, matching getErrorKinds()', async () => {
			const [viewerAsc, liveAsc] = await Promise.all([
				getViewerErrorKinds(archive, { sortBy: 'host', sortOrder: 'asc' }),
				getErrorKinds(archive, { sortBy: 'host', sortOrder: 'asc' }),
			]);
			expect(viewerAsc).toEqual(liveAsc);
			expect(viewerAsc.items.map((i) => i.host)).toEqual([
				'api.example.org',
				'example.com',
				'ext.example.net',
			]);

			const viewerDesc = await getViewerErrorKinds(archive, {
				sortBy: 'host',
				sortOrder: 'desc',
			});
			expect(viewerDesc.items.map((i) => i.host)).toEqual([
				'ext.example.net',
				'example.com',
				'api.example.org',
			]);
		});

		it('paginates with limit/offset, matching getErrorKinds()', async () => {
			const [viewerPage, livePage] = await Promise.all([
				getViewerErrorKinds(archive, {
					sortBy: 'host',
					sortOrder: 'asc',
					limit: 1,
					offset: 1,
				}),
				getErrorKinds(archive, { sortBy: 'host', sortOrder: 'asc', limit: 1, offset: 1 }),
			]);
			expect(viewerPage).toEqual(livePage);
			expect(viewerPage.items).toHaveLength(1);
			expect(viewerPage.items[0]!.host).toBe('example.com');
			expect(viewerPage.total).toBe(3);
		});

		it('returns every row when limit is omitted', async () => {
			const result = await getViewerErrorKinds(archive);
			expect(result.items).toHaveLength(3);
		});
	});

	describe('with a recorded network outage', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_get_viewer_error_kinds_outage__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'outage-test.nitpicker'),
				cwd: workingDir,
			});
			await archive.setConfig(baseConfig());

			const knex = archive.getKnex();
			await knex('crawl_errors').insert([
				{
					url: 'https://outage-caused.example/',
					isExternal: 0,
					message: 'getaddrinfo ENOTFOUND outage-caused.example',
					createdAt: 1_000_150,
				},
				{
					url: 'https://genuinely-gone.example/',
					isExternal: 0,
					message: 'getaddrinfo ENOTFOUND genuinely-gone.example',
					createdAt: 500,
				},
			]);
			const outageId = await archive.insertNetworkOutage({
				startedAt: 1_000_100,
				detectedAt: 1_000_120,
				probeHost: 'a.example',
				triggerErrorCount: 5,
				triggerHostCount: 2,
			});
			await archive.closeNetworkOutage(outageId, 1_000_200);

			await buildViewerReadModel(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('splits dns rows by attribution, matching getErrorKinds() exactly', async () => {
			const [viewerResult, liveResult] = await Promise.all([
				getViewerErrorKinds(archive),
				getErrorKinds(archive),
			]);
			const sortStable = (r: typeof liveResult) => ({
				...r,
				items: r.items.toSorted(
					(a, b) =>
						a.host.localeCompare(b.host) || a.attribution.localeCompare(b.attribution),
				),
			});
			expect(sortStable(viewerResult)).toEqual(sortStable(liveResult));

			const outageCaused = viewerResult.items.find(
				(item) => item.host === 'outage-caused.example',
			);
			const genuinelyGone = viewerResult.items.find(
				(item) => item.host === 'genuinely-gone.example',
			);
			expect(outageCaused).toMatchObject({
				kind: 'dns',
				attribution: 'network',
				count: 1,
			});
			expect(genuinelyGone).toMatchObject({ kind: 'dns', attribution: 'site', count: 1 });
		});

		it('filters by attribution', async () => {
			const [viewerNetwork, liveNetwork] = await Promise.all([
				getViewerErrorKinds(archive, { attribution: 'network' }),
				getErrorKinds(archive, { attribution: 'network' }),
			]);
			expect(viewerNetwork).toEqual(liveNetwork);
			expect(viewerNetwork.items).toHaveLength(1);
			expect(viewerNetwork.items[0]?.host).toBe('outage-caused.example');
		});

		it('filters by an array of attributions, OR-ing them together', async () => {
			const result = await getViewerErrorKinds(archive, {
				attribution: ['network', 'site'],
			});
			const [networkOnly, siteOnly] = await Promise.all([
				getViewerErrorKinds(archive, { attribution: 'network' }),
				getViewerErrorKinds(archive, { attribution: 'site' }),
			]);
			expect(result.items).toHaveLength(networkOnly.items.length + siteOnly.items.length);
		});
	});
});
