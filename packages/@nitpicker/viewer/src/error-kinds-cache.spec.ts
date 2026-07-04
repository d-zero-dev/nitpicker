import type { ArchiveContext } from './types.js';
import type { ArchiveAccessor, ArchiveManager, ErrorKindsResult } from '@nitpicker/query';

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
 * Minimal `ErrorKindsResult` literal — the cache treats the value
 * opaquely, so we only need a sentinel field per test.
 * @param channelSource - Identifying field to distinguish results across tests.
 * @returns An `ErrorKindsResult`-shaped object.
 */
function makeResult(channelSource: ErrorKindsResult['channelSource']): ErrorKindsResult {
	return { total: 0, channelSource, groups: [] };
}

describe('getCachedErrorKinds', () => {
	it('computes once per archive id and returns the cached result on every subsequent call', async () => {
		vi.mocked(getErrorKindsFastPath).mockResolvedValueOnce(makeResult('crawl_errors'));
		const context = makeContext('archive_a');

		const a = await getCachedErrorKinds(context);
		const b = await getCachedErrorKinds(context);
		const c = await getCachedErrorKinds(context);

		expect(getErrorKindsFastPath).toHaveBeenCalledTimes(1);
		expect(b).toBe(a);
		expect(c).toBe(a);
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
		resolveCompute?.(makeResult('crawl_errors'));
		await Promise.all([p1, p2, p3]);
		expect(getErrorKindsFastPath).toHaveBeenCalledTimes(1);
	});

	it('bypasses the cache in stub mode so live-crawl updates are visible on every request', async () => {
		vi.mocked(getErrorKinds)
			.mockResolvedValueOnce(makeResult('crawl_errors'))
			.mockResolvedValueOnce(makeResult('error.log'));
		const stubContext: ArchiveContext = {
			...makeContext('archive_stub'),
			mode: 'stub',
		};

		const first = await getCachedErrorKinds(stubContext);
		const second = await getCachedErrorKinds(stubContext);

		expect(first.channelSource).toBe('crawl_errors');
		expect(second.channelSource).toBe('error.log');
		expect(getErrorKinds).toHaveBeenCalledTimes(2);
	});

	it('never calls getErrorKindsFastPath in stub mode, even when a read model happens to be current in that tmpDir', async () => {
		vi.mocked(getErrorKinds).mockResolvedValueOnce(makeResult('crawl_errors'));
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
			.mockResolvedValueOnce(makeResult('crawl_errors'));
		const context = makeContext('archive_retry');

		await expect(getCachedErrorKinds(context)).rejects.toThrow(
			'transient error-kinds failure',
		);
		const recovered = await getCachedErrorKinds(context);
		expect(recovered.channelSource).toBe('crawl_errors');
		expect(getErrorKindsFastPath).toHaveBeenCalledTimes(2);
	});
});
