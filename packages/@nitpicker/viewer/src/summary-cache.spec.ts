import type { ArchiveContext } from './types.js';
import type * as NitpickerQuery from '@nitpicker/query';
import type { ArchiveAccessor, ArchiveManager, SummaryResult } from '@nitpicker/query';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCachedSummary } from './summary-cache.js';

vi.mock('@nitpicker/query', async () => {
	const actual = await vi.importActual<typeof NitpickerQuery>('@nitpicker/query');
	return {
		...actual,
		getSummary: vi.fn(),
		getSummaryFastPath: vi.fn(),
	};
});

// Disk persistence is exercised separately; here the in-memory LRU is the
// target. The stubbed `getOrComputeOnDisk` just invokes `compute`.
vi.mock('./precomputed-disk-cache.js', () => ({
	getOrComputeOnDisk: vi.fn((_cacheDir: string, _name: string, compute: () => unknown) =>
		compute(),
	),
}));

const { getSummary, getSummaryFastPath } = await import('@nitpicker/query');
const { getOrComputeOnDisk } = await import('./precomputed-disk-cache.js');

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

/**
 * Minimal `SummaryResult` literal — the cache treats the value
 * opaquely, so we only need a sentinel field per test.
 * @param baseUrl - Identifying field to distinguish results across tests.
 * @returns A `SummaryResult`-shaped object.
 */
function makeSummary(baseUrl: string): SummaryResult {
	return {
		baseUrl,
		roots: [],
		excludes: [],
		excludeKeywords: [],
		excludeUrls: [],
		maxExcludedDepth: 0,
		totalPages: 0,
		internalPages: 0,
		externalPages: 0,
		internalContents: 0,
		externalContents: 0,
		statusDistribution: [],
		metadataFulfillment: {
			title: 0,
			description: 0,
			keywords: 0,
			ogTitle: 0,
			ogDescription: 0,
			ogImage: 0,
		},
		contentTypeDistribution: [],
		networkOutageAffectedFailures: 0,
		consoleLogCounts: { pageerror: 0, error: 0, warn: 0 },
	};
}

describe('getCachedSummary', () => {
	it('computes once per archive id and returns the cached result on every subsequent call', async () => {
		// /api/summary is hit on every Summary view paint; warm hits
		// must NOT re-enter SQLite or the 10 GB-archive 26 s cold cost
		// would compound on every navigation.
		vi.mocked(getSummaryFastPath).mockResolvedValueOnce(makeSummary('first'));
		const context = makeContext('archive_a');

		const a = await getCachedSummary(context);
		const b = await getCachedSummary(context);
		const c = await getCachedSummary(context);

		expect(getSummaryFastPath).toHaveBeenCalledTimes(1);
		expect(b).toBe(a);
		expect(c).toBe(a);
	});

	it('shares an in-flight computation across concurrent callers', async () => {
		let resolveCompute: ((v: SummaryResult) => void) | undefined;
		vi.mocked(getSummaryFastPath).mockImplementationOnce(
			() =>
				new Promise<SummaryResult>((resolve) => {
					resolveCompute = resolve;
				}),
		);
		const context = makeContext('archive_b');

		const p1 = getCachedSummary(context);
		const p2 = getCachedSummary(context);
		const p3 = getCachedSummary(context);
		expect(getSummaryFastPath).toHaveBeenCalledTimes(1);
		resolveCompute?.(makeSummary('shared'));
		await Promise.all([p1, p2, p3]);
		expect(getSummaryFastPath).toHaveBeenCalledTimes(1);
	});

	it('bypasses the cache in stub mode so live-crawl updates are visible on every request', async () => {
		// In stub mode the underlying archive is being written by the
		// live crawler — caching would freeze the Summary numbers at
		// first hit. Verify the cache is NOT consulted by observing
		// that getSummary runs every time.
		vi.mocked(getSummary)
			.mockResolvedValueOnce(makeSummary('first'))
			.mockResolvedValueOnce(makeSummary('second'));
		const stubContext: ArchiveContext = {
			...makeContext('archive_stub'),
			mode: 'stub',
		};

		const first = await getCachedSummary(stubContext);
		const second = await getCachedSummary(stubContext);

		expect(first.baseUrl).toBe('first');
		expect(second.baseUrl).toBe('second');
		expect(getSummary).toHaveBeenCalledTimes(2);
	});

	it('never calls getSummaryFastPath in stub mode, even when a read model happens to be current in that tmpDir', async () => {
		// A stub's tmpDir can be the same directory a prior, already-completed
		// crawl built a `viewer_summary` read model into (`crawl --resume` /
		// `--append` / `--retry-failed` reopen it as a stub while appending
		// pages). getSummaryFastPath would treat that stale-but-schema-current
		// snapshot as valid and skip live recomputation — stub mode must never
		// give it the chance to do so.
		vi.mocked(getSummary).mockResolvedValueOnce(makeSummary('live'));
		const stubContext: ArchiveContext = {
			...makeContext('archive_stub_2'),
			mode: 'stub',
		};

		await getCachedSummary(stubContext);

		expect(getSummaryFastPath).not.toHaveBeenCalled();
	});

	it('drops a rejected entry so the next request retries instead of replaying the cached error', async () => {
		const failure = new Error('transient summary failure');
		vi.mocked(getSummaryFastPath)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(makeSummary('recovered'));
		const context = makeContext('archive_retry');

		await expect(getCachedSummary(context)).rejects.toThrow('transient summary failure');
		const recovered = await getCachedSummary(context);
		expect(recovered.baseUrl).toBe('recovered');
		expect(getSummaryFastPath).toHaveBeenCalledTimes(2);
	});

	it('passes an isValid guard to getOrComputeOnDisk that rejects a disk cache missing exclude-setting fields (issue #261)', async () => {
		// The disk cache's content-hash key does not change on a nitpicker
		// version upgrade, so a `summary.json` written before issue #261
		// could otherwise be replayed as-is and crash the Summary view's
		// `data.excludes.length` read. Verify the guard summary-cache.ts
		// wires into getOrComputeOnDisk actually enforces the new shape.
		vi.mocked(getSummaryFastPath).mockResolvedValueOnce(makeSummary('guarded'));
		const context = makeContext('archive_guard');

		await getCachedSummary(context);

		const isValid = vi.mocked(getOrComputeOnDisk).mock.calls[0]?.[3] as
			| ((value: SummaryResult) => boolean)
			| undefined;
		expect(isValid).toBeInstanceOf(Function);
		expect(isValid?.(makeSummary('complete'))).toBe(true);
		expect(
			isValid?.({ ...makeSummary('stale'), excludes: undefined } as SummaryResult),
		).toBe(false);
		expect(
			isValid?.({
				...makeSummary('stale'),
				maxExcludedDepth: undefined,
			} as SummaryResult),
		).toBe(false);
	});
});
