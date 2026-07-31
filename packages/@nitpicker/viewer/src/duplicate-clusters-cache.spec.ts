import type { ArchiveContext } from './types.js';
import type * as NitpickerQuery from '@nitpicker/query';
import type { ArchiveAccessor, ArchiveManager } from '@nitpicker/query';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCachedDuplicateBodyClusters } from './duplicate-clusters-cache.js';

vi.mock('@nitpicker/query', async () => {
	const actual = await vi.importActual<typeof NitpickerQuery>('@nitpicker/query');
	return {
		...actual,
		listDuplicateBodyClusters: vi.fn(),
	};
});

const { listDuplicateBodyClusters } = await import('@nitpicker/query');

afterEach(() => {
	vi.clearAllMocks();
});

/**
 * Build a viewer `ArchiveContext` populated with a stub `ArchiveManager`
 * that returns the supplied accessor sentinel — same convention as
 * `template-clusters-cache.spec.ts`.
 * @param archiveId - Identifier the cache will use as part of its map key.
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

describe('getCachedDuplicateBodyClusters', () => {
	// Each test uses a distinct archiveId (matching `template-clusters-cache.spec.ts`'s
	// convention) — the module-level `lru` persists across tests within this
	// file (only mock call history is reset by `afterEach`'s `clearAllMocks`),
	// so reusing an archiveId + options combo already exercised by an earlier
	// test would silently hit that test's leftover cache entry instead of
	// exercising the behaviour under test here.

	it('computes once per (archiveId, options) and returns the cached result on subsequent calls', async () => {
		vi.mocked(listDuplicateBodyClusters).mockResolvedValueOnce([
			{
				signature: 'a',
				count: 5,
				ogUrlMismatchRatio: 1,
				samplePages: [],
				commonDirectories: [],
			},
		]);
		const context = makeContext('archive_1');
		const options = { minCount: 10 };

		const first = await getCachedDuplicateBodyClusters(context, options);
		const second = await getCachedDuplicateBodyClusters(context, options);

		expect(listDuplicateBodyClusters).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
	});

	it('treats different options as distinct cache slots for the same archive', async () => {
		vi.mocked(listDuplicateBodyClusters)
			.mockResolvedValueOnce([
				{
					signature: 'a',
					count: 5,
					ogUrlMismatchRatio: 1,
					samplePages: [],
					commonDirectories: [],
				},
			])
			.mockResolvedValueOnce([
				{
					signature: 'b',
					count: 3,
					ogUrlMismatchRatio: 0,
					samplePages: [],
					commonDirectories: [],
				},
			]);
		const context = makeContext('archive_2');

		const a = await getCachedDuplicateBodyClusters(context, { minCount: 10 });
		const b = await getCachedDuplicateBodyClusters(context, { minCount: 3 });

		expect(a[0]?.signature).toBe('a');
		expect(b[0]?.signature).toBe('b');
		expect(listDuplicateBodyClusters).toHaveBeenCalledTimes(2);
	});

	it('bypasses the cache in stub mode so live-crawl updates are visible on every request', async () => {
		vi.mocked(listDuplicateBodyClusters)
			.mockResolvedValueOnce([
				{
					signature: 'first',
					count: 5,
					ogUrlMismatchRatio: 1,
					samplePages: [],
					commonDirectories: [],
				},
			])
			.mockResolvedValueOnce([
				{
					signature: 'second',
					count: 5,
					ogUrlMismatchRatio: 1,
					samplePages: [],
					commonDirectories: [],
				},
			]);
		const stubContext: ArchiveContext = { ...makeContext('archive_3'), mode: 'stub' };
		const options = { minCount: 10 };

		const first = await getCachedDuplicateBodyClusters(stubContext, options);
		const second = await getCachedDuplicateBodyClusters(stubContext, options);

		expect(first[0]?.signature).toBe('first');
		expect(second[0]?.signature).toBe('second');
		expect(listDuplicateBodyClusters).toHaveBeenCalledTimes(2);
	});

	it('drops a rejected entry so the next request retries instead of replaying the cached error', async () => {
		const failure = new Error('transient SQL failure');
		vi.mocked(listDuplicateBodyClusters)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce([
				{
					signature: 'recovered',
					count: 5,
					ogUrlMismatchRatio: 1,
					samplePages: [],
					commonDirectories: [],
				},
			]);
		const context = makeContext('archive_4');
		const options = { minCount: 10 };

		await expect(getCachedDuplicateBodyClusters(context, options)).rejects.toThrow(
			'transient SQL failure',
		);

		const recovered = await getCachedDuplicateBodyClusters(context, options);
		expect(recovered[0]?.signature).toBe('recovered');
		expect(listDuplicateBodyClusters).toHaveBeenCalledTimes(2);
	});
});
