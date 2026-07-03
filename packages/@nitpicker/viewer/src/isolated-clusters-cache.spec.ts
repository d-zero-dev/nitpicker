import type { ArchiveContext } from './types.js';
import type * as NitpickerQuery from '@nitpicker/query';
import type { ArchiveAccessor, ArchiveManager } from '@nitpicker/query';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCachedIsolatedClusters } from './isolated-clusters-cache.js';

vi.mock('@nitpicker/query', async () => {
	const actual = await vi.importActual<typeof NitpickerQuery>('@nitpicker/query');
	return {
		...actual,
		computeIsolatedClusters: vi.fn(),
	};
});

// Disk persistence is tested separately in `precomputed-disk-cache.spec.ts`.
// Here we only care that the in-memory LRU + stub-mode policies behave; the
// stub returns the compute result directly so disk hits / misses do not
// pollute the assertions on `computeIsolatedClusters` call counts.
vi.mock('./precomputed-disk-cache.js', () => ({
	getOrComputeOnDisk: vi.fn((_cacheDir: string, _name: string, compute: () => unknown) =>
		compute(),
	),
}));

const { computeIsolatedClusters } = await import('@nitpicker/query');

afterEach(() => {
	vi.clearAllMocks();
});

/**
 * Build a viewer `ArchiveContext` populated with a stub `ArchiveManager`
 * that returns the supplied accessor sentinel. The cache only consults
 * `context.archiveId` as the key and forwards `accessor` to the mocked
 * `computeIsolatedClusters`; everything else can be a placeholder.
 * @param archiveId - Identifier the cache will use as its map key.
 * @returns A context shape compatible with the cache module's input.
 */
function makeContext(archiveId: string): ArchiveContext {
	const accessor = { id: archiveId } as unknown as ArchiveAccessor;
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

describe('getCachedIsolatedClusters', () => {
	it('computes once per archive id and returns the cached result on every subsequent call', async () => {
		// The whole reason this cache exists: a 20-30s union-find pass
		// must run once per archive, not once per endpoint hit.
		vi.mocked(computeIsolatedClusters).mockResolvedValueOnce([
			{ representativeUrl: 'https://x', members: [], size: 1 },
		]);
		const context = makeContext('archive_a');

		const first = await getCachedIsolatedClusters(context);
		const second = await getCachedIsolatedClusters(context);
		const third = await getCachedIsolatedClusters(context);

		expect(computeIsolatedClusters).toHaveBeenCalledTimes(1);
		// Same reference returned each time — confirms the cached value,
		// not a fresh `await` of the same source.
		expect(second).toBe(first);
		expect(third).toBe(first);
	});

	it('shares one in-flight computation across concurrent callers (no double work)', async () => {
		// The viewer's "Isolated" page hits both endpoints in parallel.
		// Without promise-level dedup each would trigger its own
		// computeIsolatedClusters call.
		let resolveCompute: ((value: ReturnType<typeof Array.of>) => void) | undefined;
		vi.mocked(computeIsolatedClusters).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveCompute = resolve as never;
				}),
		);
		const context = makeContext('archive_b');

		const p1 = getCachedIsolatedClusters(context);
		const p2 = getCachedIsolatedClusters(context);
		const p3 = getCachedIsolatedClusters(context);

		expect(computeIsolatedClusters).toHaveBeenCalledTimes(1);
		resolveCompute?.([]);
		await Promise.all([p1, p2, p3]);
		expect(computeIsolatedClusters).toHaveBeenCalledTimes(1);
	});

	it('uses different archive ids as distinct cache slots', async () => {
		// Two viewer sessions / two opened archives must not share results.
		vi.mocked(computeIsolatedClusters)
			.mockResolvedValueOnce([{ representativeUrl: 'A', members: [], size: 1 }])
			.mockResolvedValueOnce([{ representativeUrl: 'B', members: [], size: 1 }]);

		const a = await getCachedIsolatedClusters(makeContext('archive_x'));
		const b = await getCachedIsolatedClusters(makeContext('archive_y'));

		expect(a[0]?.representativeUrl).toBe('A');
		expect(b[0]?.representativeUrl).toBe('B');
		expect(computeIsolatedClusters).toHaveBeenCalledTimes(2);
	});

	it('evicts the oldest entry past the cache budget so long-running viewer sessions cannot grow unbounded', async () => {
		// The cap is 4; six distinct opens must not retain six entries.
		// After the cap fills, looking up the oldest entry (`archive_1`)
		// triggers a re-compute — which is the observable evidence of
		// eviction.
		const results = ['1', '2', '3', '4', '5', '6'];
		for (const id of results) {
			vi.mocked(computeIsolatedClusters).mockResolvedValueOnce([
				{ representativeUrl: id, members: [], size: 1 },
			]);
		}
		for (const id of results) {
			await getCachedIsolatedClusters(makeContext(`archive_${id}`));
		}

		// archive_1 should have been evicted (inserted first, more than
		// MAX_ENTRIES inserts since then). archive_6 should still be cached.
		vi.mocked(computeIsolatedClusters).mockResolvedValueOnce([
			{ representativeUrl: '1-recomputed', members: [], size: 1 },
		]);
		const evictedRerun = await getCachedIsolatedClusters(makeContext('archive_1'));
		expect(evictedRerun[0]?.representativeUrl).toBe('1-recomputed');

		const stillCached = await getCachedIsolatedClusters(makeContext('archive_6'));
		expect(stillCached[0]?.representativeUrl).toBe('6');
	});

	it('bypasses the cache in stub mode so live-crawl updates are visible on every request', async () => {
		// Stub mode points at a `._nitpicker-*` directory whose writer
		// (the live crawler) keeps adding pages and anchors. Serving
		// from cache would freeze the isolated-* surface at the first
		// hit — a real UX bug for the "monitor the in-progress crawl"
		// workflow. Verify the cache is NOT consulted in stub mode by
		// observing that computeIsolatedClusters runs every time.
		vi.mocked(computeIsolatedClusters)
			.mockResolvedValueOnce([{ representativeUrl: 'first', members: [], size: 1 }])
			.mockResolvedValueOnce([{ representativeUrl: 'second', members: [], size: 1 }]);
		const stubContext: ArchiveContext = {
			...makeContext('archive_stub'),
			mode: 'stub',
		};

		const first = await getCachedIsolatedClusters(stubContext);
		const second = await getCachedIsolatedClusters(stubContext);

		expect(first[0]?.representativeUrl).toBe('first');
		expect(second[0]?.representativeUrl).toBe('second');
		expect(computeIsolatedClusters).toHaveBeenCalledTimes(2);
	});

	it('drops a rejected entry so the next request retries instead of replaying the cached error', async () => {
		// A cached rejection would mean the user is stuck on an error
		// state for the whole viewer session even after the underlying
		// transient cause clears.
		const failure = new Error('transient SQL failure');
		vi.mocked(computeIsolatedClusters)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce([{ representativeUrl: 'recovered', members: [], size: 1 }]);
		const context = makeContext('archive_retry');

		await expect(getCachedIsolatedClusters(context)).rejects.toThrow(
			'transient SQL failure',
		);

		const recovered = await getCachedIsolatedClusters(context);
		expect(recovered[0]?.representativeUrl).toBe('recovered');
		expect(computeIsolatedClusters).toHaveBeenCalledTimes(2);
	});
});
