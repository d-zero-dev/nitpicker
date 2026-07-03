import type { ArchiveContext } from './types.js';
import type * as NitpickerQuery from '@nitpicker/query';
import type { ArchiveAccessor, ArchiveManager, LinkGraph } from '@nitpicker/query';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCachedLinkGraph } from './graph-cache.js';

vi.mock('@nitpicker/query', async () => {
	const actual = await vi.importActual<typeof NitpickerQuery>('@nitpicker/query');
	return {
		...actual,
		getLinkGraph: vi.fn(),
	};
});

// Disk persistence is exercised by `precomputed-disk-cache.spec.ts`;
// here the in-memory LRU + cache-key shape are the target.
vi.mock('./precomputed-disk-cache.js', () => ({
	getOrComputeOnDisk: vi.fn((_cacheDir: string, _name: string, compute: () => unknown) =>
		compute(),
	),
}));

const { getLinkGraph } = await import('@nitpicker/query');

afterEach(() => {
	vi.clearAllMocks();
});

/**
 * Build a viewer `ArchiveContext` whose manager returns a stub accessor.
 * Only `context.archiveId` and `context.mode` are consulted by the
 * cache; everything else is a placeholder.
 * @param archiveId - Identifier the cache uses as part of its map key.
 * @param mode - Archive open mode.
 * @returns A context shape compatible with the cache module's input.
 */
function makeContext(
	archiveId: string,
	mode: 'archive' | 'stub' = 'archive',
): ArchiveContext {
	const accessor = { id: archiveId } as unknown as ArchiveAccessor;
	const manager = {
		get: vi.fn().mockReturnValue(accessor),
	} as unknown as ArchiveManager;
	return {
		manager,
		archiveId,
		filePath: `/fake/${archiveId}.nitpicker`,
		mode,
		crawlerLockHolder: null,
	};
}

/**
 * Sentinel `LinkGraph` value — the cache treats it opaquely.
 * @param tag - Identifying field to distinguish results across tests.
 * @returns A `LinkGraph`-shaped object.
 */
function makeGraph(tag: string): LinkGraph {
	return {
		nodes: [{ url: `https://example.com/${tag}`, status: 200, inDegree: 0 }],
		edges: [],
		truncated: false,
	};
}

describe('getCachedLinkGraph', () => {
	it('computes once per (archiveId, limit) and reuses the cached promise', async () => {
		vi.mocked(getLinkGraph).mockResolvedValueOnce(makeGraph('first'));
		const context = makeContext('archive_a');

		const a = await getCachedLinkGraph(context, 1000);
		const b = await getCachedLinkGraph(context, 1000);

		expect(getLinkGraph).toHaveBeenCalledTimes(1);
		expect(b).toBe(a);
	});

	it('treats distinct limit values as distinct cache entries', async () => {
		// A direct CLI caller can hit `?limit=0` (uncapped) while the
		// viewer is hitting `?limit=1000`. The two MUST NOT share a
		// cache slot or the uncapped caller might serve a capped graph.
		vi.mocked(getLinkGraph)
			.mockResolvedValueOnce(makeGraph('capped'))
			.mockResolvedValueOnce(makeGraph('uncapped'));
		const context = makeContext('archive_b');

		const capped = await getCachedLinkGraph(context, 1000);
		const uncapped = await getCachedLinkGraph(context);

		expect(capped.nodes[0]?.url).toContain('capped');
		expect(uncapped.nodes[0]?.url).toContain('uncapped');
		expect(getLinkGraph).toHaveBeenCalledTimes(2);
	});

	it('shares an in-flight computation across concurrent callers', async () => {
		let resolveCompute: ((value: LinkGraph) => void) | undefined;
		vi.mocked(getLinkGraph).mockImplementationOnce(
			() =>
				new Promise<LinkGraph>((resolve) => {
					resolveCompute = resolve;
				}),
		);
		const context = makeContext('archive_c');

		const p1 = getCachedLinkGraph(context, 1000);
		const p2 = getCachedLinkGraph(context, 1000);
		expect(getLinkGraph).toHaveBeenCalledTimes(1);

		resolveCompute?.(makeGraph('shared'));
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1).toBe(r2);
		expect(getLinkGraph).toHaveBeenCalledTimes(1);
	});

	it('bypasses the cache in stub mode so live-crawl updates are visible on every request', async () => {
		vi.mocked(getLinkGraph)
			.mockResolvedValueOnce(makeGraph('first'))
			.mockResolvedValueOnce(makeGraph('second'));
		const stubContext = makeContext('archive_stub', 'stub');

		const first = await getCachedLinkGraph(stubContext, 1000);
		const second = await getCachedLinkGraph(stubContext, 1000);

		expect(first.nodes[0]?.url).toContain('first');
		expect(second.nodes[0]?.url).toContain('second');
		expect(getLinkGraph).toHaveBeenCalledTimes(2);
	});

	it('drops a rejected entry so the next request retries instead of replaying the cached failure', async () => {
		const failure = new Error('transient graph failure');
		vi.mocked(getLinkGraph)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(makeGraph('recovered'));
		const context = makeContext('archive_retry');

		await expect(getCachedLinkGraph(context, 1000)).rejects.toThrow(
			'transient graph failure',
		);
		const recovered = await getCachedLinkGraph(context, 1000);
		expect(recovered.nodes[0]?.url).toContain('recovered');
		expect(getLinkGraph).toHaveBeenCalledTimes(2);
	});
});
