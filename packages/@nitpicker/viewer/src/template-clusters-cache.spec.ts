import type { ArchiveContext } from './types.js';
import type * as NitpickerQuery from '@nitpicker/query';
import type { ArchiveAccessor, ArchiveManager } from '@nitpicker/query';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCachedTemplateClusters } from './template-clusters-cache.js';

vi.mock('@nitpicker/query', async () => {
	const actual = await vi.importActual<typeof NitpickerQuery>('@nitpicker/query');
	return {
		...actual,
		listPageTemplateClusters: vi.fn(),
	};
});

const { listPageTemplateClusters } = await import('@nitpicker/query');

afterEach(() => {
	vi.clearAllMocks();
});

/**
 * Build a viewer `ArchiveContext` populated with a stub `ArchiveManager`
 * that returns the supplied accessor sentinel. The cache only consults
 * `context.archiveId` as the key and forwards `accessor` to the mocked
 * `listPageTemplateClusters`; everything else can be a placeholder.
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

describe('getCachedTemplateClusters', () => {
	it('computes once per archive id and returns the cached result on every subsequent call', async () => {
		vi.mocked(listPageTemplateClusters).mockResolvedValueOnce({
			hasClassification: true,
			clusters: [
				{
					templateKey: 'k',
					pageCount: 1,
					commonDirectories: [],
					commonStylesheetUrls: [],
				},
			],
		});
		const context = makeContext('archive_a');

		const first = await getCachedTemplateClusters(context);
		const second = await getCachedTemplateClusters(context);
		const third = await getCachedTemplateClusters(context);

		expect(listPageTemplateClusters).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
		expect(third).toBe(first);
	});

	it('shares one in-flight computation across concurrent callers (no double work)', async () => {
		let resolveCompute: ((value: unknown) => void) | undefined;
		vi.mocked(listPageTemplateClusters).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveCompute = resolve as never;
				}),
		);
		const context = makeContext('archive_b');

		const p1 = getCachedTemplateClusters(context);
		const p2 = getCachedTemplateClusters(context);
		const p3 = getCachedTemplateClusters(context);

		expect(listPageTemplateClusters).toHaveBeenCalledTimes(1);
		resolveCompute?.({ hasClassification: false, clusters: [] });
		await Promise.all([p1, p2, p3]);
		expect(listPageTemplateClusters).toHaveBeenCalledTimes(1);
	});

	it('uses different archive ids as distinct cache slots', async () => {
		vi.mocked(listPageTemplateClusters)
			.mockResolvedValueOnce({
				hasClassification: true,
				clusters: [
					{
						templateKey: 'A',
						pageCount: 1,
						commonDirectories: [],
						commonStylesheetUrls: [],
						commonStylesheetFileNames: [],
					},
				],
			})
			.mockResolvedValueOnce({
				hasClassification: true,
				clusters: [
					{
						templateKey: 'B',
						pageCount: 1,
						commonDirectories: [],
						commonStylesheetUrls: [],
						commonStylesheetFileNames: [],
					},
				],
			});

		const a = await getCachedTemplateClusters(makeContext('archive_x'));
		const b = await getCachedTemplateClusters(makeContext('archive_y'));

		expect(a.clusters[0]?.templateKey).toBe('A');
		expect(b.clusters[0]?.templateKey).toBe('B');
		expect(listPageTemplateClusters).toHaveBeenCalledTimes(2);
	});

	it('evicts the oldest entry past the cache budget so long-running viewer sessions cannot grow unbounded', async () => {
		// The cap is 4; six distinct opens must not retain six entries.
		const ids = ['1', '2', '3', '4', '5', '6'];
		for (const id of ids) {
			vi.mocked(listPageTemplateClusters).mockResolvedValueOnce({
				hasClassification: true,
				clusters: [
					{
						templateKey: id,
						pageCount: 1,
						commonDirectories: [],
						commonStylesheetUrls: [],
						commonStylesheetFileNames: [],
					},
				],
			});
		}
		for (const id of ids) {
			await getCachedTemplateClusters(makeContext(`archive_${id}`));
		}

		// archive_1 should have been evicted (inserted first, more than
		// MAX_ENTRIES inserts since then). archive_6 should still be cached.
		vi.mocked(listPageTemplateClusters).mockResolvedValueOnce({
			hasClassification: true,
			clusters: [
				{
					templateKey: '1-recomputed',
					pageCount: 1,
					commonDirectories: [],
					commonStylesheetUrls: [],
				},
			],
		});
		const evictedRerun = await getCachedTemplateClusters(makeContext('archive_1'));
		expect(evictedRerun.clusters[0]?.templateKey).toBe('1-recomputed');

		const stillCached = await getCachedTemplateClusters(makeContext('archive_6'));
		expect(stillCached.clusters[0]?.templateKey).toBe('6');
	});

	it('bypasses the cache in stub mode so live-crawl updates are visible on every request', async () => {
		vi.mocked(listPageTemplateClusters)
			.mockResolvedValueOnce({
				hasClassification: true,
				clusters: [
					{
						templateKey: 'first',
						pageCount: 1,
						commonDirectories: [],
						commonStylesheetUrls: [],
						commonStylesheetFileNames: [],
					},
				],
			})
			.mockResolvedValueOnce({
				hasClassification: true,
				clusters: [
					{
						templateKey: 'second',
						pageCount: 1,
						commonDirectories: [],
						commonStylesheetUrls: [],
						commonStylesheetFileNames: [],
					},
				],
			});
		const stubContext: ArchiveContext = { ...makeContext('archive_stub'), mode: 'stub' };

		const first = await getCachedTemplateClusters(stubContext);
		const second = await getCachedTemplateClusters(stubContext);

		expect(first.clusters[0]?.templateKey).toBe('first');
		expect(second.clusters[0]?.templateKey).toBe('second');
		expect(listPageTemplateClusters).toHaveBeenCalledTimes(2);
	});

	it('drops a rejected entry so the next request retries instead of replaying the cached error', async () => {
		const failure = new Error('transient SQL failure');
		vi.mocked(listPageTemplateClusters)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce({
				hasClassification: true,
				clusters: [
					{
						templateKey: 'recovered',
						pageCount: 1,
						commonDirectories: [],
						commonStylesheetUrls: [],
						commonStylesheetFileNames: [],
					},
				],
			});
		const context = makeContext('archive_retry');

		await expect(getCachedTemplateClusters(context)).rejects.toThrow(
			'transient SQL failure',
		);

		const recovered = await getCachedTemplateClusters(context);
		expect(recovered.clusters[0]?.templateKey).toBe('recovered');
		expect(listPageTemplateClusters).toHaveBeenCalledTimes(2);
	});
});
