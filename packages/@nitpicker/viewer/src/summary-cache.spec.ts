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
	};
});

// Disk persistence is exercised separately; here the in-memory LRU is the
// target. The stubbed `getOrComputeOnDisk` just invokes `compute`.
vi.mock('./precomputed-disk-cache.js', () => ({
	getOrComputeOnDisk: vi.fn((_cacheDir: string, _name: string, compute: () => unknown) =>
		compute(),
	),
}));

const { getSummary } = await import('@nitpicker/query');

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
	};
}

describe('getCachedSummary', () => {
	it('computes once per archive id and returns the cached result on every subsequent call', async () => {
		// /api/summary is hit on every Summary view paint; warm hits
		// must NOT re-enter SQLite or the 10 GB-archive 26 s cold cost
		// would compound on every navigation.
		vi.mocked(getSummary).mockResolvedValueOnce(makeSummary('first'));
		const context = makeContext('archive_a');

		const a = await getCachedSummary(context);
		const b = await getCachedSummary(context);
		const c = await getCachedSummary(context);

		expect(getSummary).toHaveBeenCalledTimes(1);
		expect(b).toBe(a);
		expect(c).toBe(a);
	});

	it('shares an in-flight computation across concurrent callers', async () => {
		let resolveCompute: ((v: SummaryResult) => void) | undefined;
		vi.mocked(getSummary).mockImplementationOnce(
			() =>
				new Promise<SummaryResult>((resolve) => {
					resolveCompute = resolve;
				}),
		);
		const context = makeContext('archive_b');

		const p1 = getCachedSummary(context);
		const p2 = getCachedSummary(context);
		const p3 = getCachedSummary(context);
		expect(getSummary).toHaveBeenCalledTimes(1);
		resolveCompute?.(makeSummary('shared'));
		await Promise.all([p1, p2, p3]);
		expect(getSummary).toHaveBeenCalledTimes(1);
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

	it('drops a rejected entry so the next request retries instead of replaying the cached error', async () => {
		const failure = new Error('transient summary failure');
		vi.mocked(getSummary)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(makeSummary('recovered'));
		const context = makeContext('archive_retry');

		await expect(getCachedSummary(context)).rejects.toThrow('transient summary failure');
		const recovered = await getCachedSummary(context);
		expect(recovered.baseUrl).toBe('recovered');
		expect(getSummary).toHaveBeenCalledTimes(2);
	});
});
