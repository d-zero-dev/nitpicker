import type { ArchiveContext } from './types.js';
import type {
	ArchiveAccessor,
	ArchiveManager,
	ErrorKindEntry,
	ErrorKindsResult,
} from '@nitpicker/query';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCachedErrorKinds } from './error-kinds-cache.js';

vi.mock('@nitpicker/query', async () => {
	const actual =
		await vi.importActual<typeof import('@nitpicker/query')>('@nitpicker/query');
	return {
		...actual,
		getErrorKinds: vi.fn(),
		getErrorKindsFastPath: vi.fn(),
	};
});

// Disk persistence is exercised separately; here the in-memory LRU is the
// target. The stubbed `getOrComputeOnDisk` just invokes `compute`.
vi.mock('./precomputed-disk-cache.js', () => ({
	getOrComputeOnDisk: vi.fn((_cacheDir: string, _name: string, compute: () => unknown) =>
		compute(),
	),
}));

const { getErrorKinds, getErrorKindsFastPath } = await import('@nitpicker/query');

afterEach(() => {
	vi.clearAllMocks();
});

/**
 * Build a viewer `ArchiveContext` whose manager returns a stub accessor.
 * The cache only consults `context.archiveId` as the key; everything
 * else can be a placeholder.
 * @param archiveId - Identifier the cache will use as its map key.
 * @returns A context shape compatible with the cache module's input.
 */
function makeContext(archiveId: string): ArchiveContext {
	const accessor = {
		id: archiveId,
		tmpDir: `/fake/${archiveId}`,
	} as unknown as ArchiveAccessor;
	const manager = {
		get: vi.fn().mockReturnValue(accessor),
	} as unknown as ArchiveManager;
	return {
		manager,
		archiveId,
		filePath: `/fake/${archiveId}.nitpicker`,
		mode: 'archive',
		crawlerLockHolder: null,
	};
}

/**
 * Build a minimal {@link ErrorKindEntry}, overridable per test.
 * @param overrides - Fields to override.
 * @returns The constructed entry.
 */
function makeEntry(overrides: Partial<ErrorKindEntry> = {}): ErrorKindEntry {
	return {
		host: 'a.example.com',
		kind: 'dns',
		attribution: 'site',
		count: 1,
		sampleUrls: [],
		overflowedCount: 0,
		...overrides,
	};
}

/**
 * Build a minimal `ErrorKindsResult` literal — the cache treats the value
 * mostly opaquely, so a small default item list plus an identifying facets
 * field is enough to tell which computed snapshot answered.
 * @param overrides - Fields to override.
 * @returns An `ErrorKindsResult`-shaped object.
 */
function makeResult(overrides: Partial<ErrorKindsResult> = {}): ErrorKindsResult {
	return {
		items: [makeEntry()],
		total: 1,
		facets: { totalRecords: 1, channelSource: 'crawl_errors' },
		...overrides,
	};
}

describe('getCachedErrorKinds', () => {
	it('computes once per archive id and returns the same (options-applied) content on every subsequent call', async () => {
		vi.mocked(getErrorKindsFastPath).mockResolvedValueOnce(makeResult());
		const context = makeContext('archive_a');

		const a = await getCachedErrorKinds(context);
		const b = await getCachedErrorKinds(context);
		const c = await getCachedErrorKinds(context);

		expect(getErrorKindsFastPath).toHaveBeenCalledTimes(1);
		expect(getErrorKindsFastPath).toHaveBeenCalledWith(expect.anything(), {});
		expect(b).toEqual(a);
		expect(c).toEqual(a);
	});

	it('shares an in-flight computation across concurrent callers', async () => {
		let resolveCompute: ((v: ErrorKindsResult) => void) | undefined;
		vi.mocked(getErrorKindsFastPath).mockImplementationOnce(
			() =>
				new Promise<ErrorKindsResult>((resolve) => {
					resolveCompute = resolve;
				}),
		);
		const context = makeContext('archive_b');

		const p1 = getCachedErrorKinds(context);
		const p2 = getCachedErrorKinds(context);
		const p3 = getCachedErrorKinds(context);
		expect(getErrorKindsFastPath).toHaveBeenCalledTimes(1);
		resolveCompute?.(makeResult());
		await Promise.all([p1, p2, p3]);
		expect(getErrorKindsFastPath).toHaveBeenCalledTimes(1);
	});

	it('bypasses the cache in stub mode so live-crawl updates are visible on every request', async () => {
		vi.mocked(getErrorKinds)
			.mockResolvedValueOnce(
				makeResult({ facets: { totalRecords: 1, channelSource: 'crawl_errors' } }),
			)
			.mockResolvedValueOnce(
				makeResult({ facets: { totalRecords: 2, channelSource: 'error.log' } }),
			);
		const stubContext: ArchiveContext = {
			...makeContext('archive_stub'),
			mode: 'stub',
		};

		const first = await getCachedErrorKinds(stubContext);
		const second = await getCachedErrorKinds(stubContext);

		expect(first.facets.channelSource).toBe('crawl_errors');
		expect(second.facets.channelSource).toBe('error.log');
		expect(getErrorKinds).toHaveBeenCalledTimes(2);
	});

	it('passes the caller-supplied options straight through to getErrorKinds in stub mode (no cached snapshot to slice)', async () => {
		vi.mocked(getErrorKinds).mockResolvedValueOnce(makeResult());
		const stubContext: ArchiveContext = {
			...makeContext('archive_stub_opts'),
			mode: 'stub',
		};

		await getCachedErrorKinds(stubContext, { kind: 'dns', limit: 5 });

		expect(getErrorKinds).toHaveBeenCalledWith(expect.anything(), {
			kind: 'dns',
			limit: 5,
		});
	});

	it('never calls getErrorKindsFastPath in stub mode, even when a read model happens to be current in that tmpDir', async () => {
		vi.mocked(getErrorKinds).mockResolvedValueOnce(makeResult());
		const stubContext: ArchiveContext = {
			...makeContext('archive_stub_2'),
			mode: 'stub',
		};

		await getCachedErrorKinds(stubContext);

		expect(getErrorKindsFastPath).not.toHaveBeenCalled();
	});

	it('drops a rejected entry so the next request retries instead of replaying the cached error', async () => {
		const failure = new Error('transient error-kinds failure');
		vi.mocked(getErrorKindsFastPath)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(makeResult());
		const context = makeContext('archive_retry');

		await expect(getCachedErrorKinds(context)).rejects.toThrow(
			'transient error-kinds failure',
		);
		const recovered = await getCachedErrorKinds(context);
		expect(recovered.facets.channelSource).toBe('crawl_errors');
		expect(getErrorKindsFastPath).toHaveBeenCalledTimes(2);
	});

	describe('applying options on top of the cached unfiltered snapshot', () => {
		const FULL = makeResult({
			items: [
				makeEntry({ host: 'a.example.com', kind: 'dns', count: 5 }),
				makeEntry({ host: 'b.example.com', kind: 'timeout', count: 3 }),
				makeEntry({ host: 'a.example.com', kind: 'timeout', count: 1 }),
			],
			total: 3,
			facets: { totalRecords: 9, channelSource: 'crawl_errors' },
		});

		it('computes the unfiltered snapshot only once regardless of differing per-request options', async () => {
			vi.mocked(getErrorKindsFastPath).mockResolvedValueOnce(FULL);
			const context = makeContext('archive_opts_dedup');

			await getCachedErrorKinds(context, { kind: 'dns' });
			await getCachedErrorKinds(context, { kind: 'timeout' });
			await getCachedErrorKinds(context, { sortBy: 'host', sortOrder: 'asc' });

			expect(getErrorKindsFastPath).toHaveBeenCalledTimes(1);
			expect(getErrorKindsFastPath).toHaveBeenCalledWith(expect.anything(), {});
		});

		it('filters by host and kind independently and combined', async () => {
			vi.mocked(getErrorKindsFastPath).mockResolvedValueOnce(FULL);
			const context = makeContext('archive_opts_filter');

			const byHost = await getCachedErrorKinds(context, { host: 'a.example.com' });
			expect(byHost.items.map((i) => i.kind).toSorted()).toEqual(['dns', 'timeout']);
			expect(byHost.total).toBe(2);
			// facets stay archive-wide, unaffected by the filter.
			expect(byHost.facets.totalRecords).toBe(9);

			const byKind = await getCachedErrorKinds(context, { kind: 'timeout' });
			expect(byKind.items.map((i) => i.host).toSorted()).toEqual([
				'a.example.com',
				'b.example.com',
			]);

			const byBoth = await getCachedErrorKinds(context, {
				host: 'a.example.com',
				kind: 'timeout',
			});
			expect(byBoth.items).toHaveLength(1);
			expect(byBoth.items[0]).toMatchObject({ host: 'a.example.com', kind: 'timeout' });
		});

		it('filters by attribution — regression test for the missing attribution filter (issue #91)', async () => {
			const withAttribution = makeResult({
				items: [
					makeEntry({
						host: 'a.example.com',
						kind: 'dns',
						attribution: 'site',
						count: 5,
					}),
					makeEntry({
						host: 'a.example.com',
						kind: 'dns',
						attribution: 'network',
						count: 2,
					}),
				],
				total: 2,
				facets: { totalRecords: 7, channelSource: 'crawl_errors' },
			});
			vi.mocked(getErrorKindsFastPath).mockResolvedValueOnce(withAttribution);
			const context = makeContext('archive_opts_filter_attribution');

			const networkOnly = await getCachedErrorKinds(context, { attribution: 'network' });
			expect(networkOnly.items).toHaveLength(1);
			expect(networkOnly.items[0]).toMatchObject({ attribution: 'network', count: 2 });
			// facets stay archive-wide, unaffected by the filter.
			expect(networkOnly.facets.totalRecords).toBe(7);
		});

		it('sorts by count descending by default', async () => {
			vi.mocked(getErrorKindsFastPath).mockResolvedValueOnce(FULL);
			const context = makeContext('archive_opts_sort_default');

			const result = await getCachedErrorKinds(context);
			expect(result.items.map((i) => i.count)).toEqual([5, 3, 1]);
		});

		it('sorts by host ascending/descending on request', async () => {
			vi.mocked(getErrorKindsFastPath).mockResolvedValueOnce(FULL);
			const context = makeContext('archive_opts_sort_host');

			const asc = await getCachedErrorKinds(context, {
				sortBy: 'host',
				sortOrder: 'asc',
			});
			expect(asc.items.map((i) => i.host)).toEqual([
				'a.example.com',
				'a.example.com',
				'b.example.com',
			]);

			const desc = await getCachedErrorKinds(context, {
				sortBy: 'host',
				sortOrder: 'desc',
			});
			expect(desc.items.map((i) => i.host)).toEqual([
				'b.example.com',
				'a.example.com',
				'a.example.com',
			]);
		});

		it('tie-breaks by kind ascending when sortBy=host ties on host, matching getViewerErrorKinds() — regression test', async () => {
			// Regression test: sorting with no secondary key would leave
			// same-host ties (a.example.com/dns count=5, a.example.com/timeout
			// count=1) in whatever order the cached count-desc snapshot
			// happens to hold them (dns before timeout, since dns has the
			// higher count) instead of the deterministic kind-ascending
			// tie-break getViewerErrorKinds applies in SQL.
			vi.mocked(getErrorKindsFastPath).mockResolvedValueOnce(FULL);
			const context = makeContext('archive_opts_sort_host_tiebreak');

			const asc = await getCachedErrorKinds(context, {
				sortBy: 'host',
				sortOrder: 'asc',
			});
			const aExampleComEntries = asc.items.filter((i) => i.host === 'a.example.com');
			expect(aExampleComEntries.map((i) => i.kind)).toEqual(['dns', 'timeout']);
		});

		it('falls back to count-desc for an out-of-range sortBy instead of silently no-op sorting — regression test', async () => {
			// Regression test: indexing items by the raw, unvalidated sortBy
			// (`item['bogus']`) yields undefined on every entry, making the
			// sort a no-op that returns the cached snapshot's own order
			// regardless of the (also wrongly-defaulted) sortOrder.
			vi.mocked(getErrorKindsFastPath).mockResolvedValueOnce(FULL);
			const context = makeContext('archive_opts_sort_bogus');

			const result = await getCachedErrorKinds(context, {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulating an out-of-range value from an untyped caller (e.g. a raw query string).
				sortBy: 'bogus' as any,
			});
			expect(result.items.map((i) => i.count)).toEqual([5, 3, 1]);
		});

		it('paginates with limit/offset, and returns every row when limit is omitted', async () => {
			vi.mocked(getErrorKindsFastPath).mockResolvedValueOnce(FULL);
			const context = makeContext('archive_opts_paginate');

			const all = await getCachedErrorKinds(context);
			expect(all.items).toHaveLength(3);

			const page = await getCachedErrorKinds(context, { limit: 1, offset: 1 });
			expect(page.items).toHaveLength(1);
			expect(page.items[0]).toMatchObject({ host: 'b.example.com', count: 3 });
			// total reflects the filtered set (no filter here, so all 3), not the page size.
			expect(page.total).toBe(3);
		});
	});
});
