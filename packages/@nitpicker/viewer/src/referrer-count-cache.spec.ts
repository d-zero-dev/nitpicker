import type { ArchiveContext } from './types.js';
import type { ArchiveAccessor, ArchiveManager } from '@nitpicker/query';

import { afterEach, describe, expect, it, vi } from 'vitest';

// Disk persistence layer is tested separately. Stub it so spec assertions
// observe only the in-memory LRU + GROUP BY shape.
vi.mock('./precomputed-disk-cache.js', () => ({
	getOrComputeOnDisk: vi.fn((_cacheDir: string, _name: string, compute: () => unknown) =>
		compute(),
	),
}));

const { getCachedReferrerCounts } = await import('./referrer-count-cache.js');

/**
 * Build a stub knex chain that returns the supplied aggregate rows
 * for `select(...).count(...).groupBy(...)`. The chain is read by
 * `referrer-count-cache.ts` to assemble the `Map<pageId, count>`, so
 * we only need to model what the implementation actually awaits.
 * @param rows - Aggregate rows the GROUP BY should produce.
 */
function makeKnex(rows: Array<{ canonicalId: number; count: number }>): unknown {
	const chain: Record<string, unknown> = {};
	const next = () => chain;
	chain.join = vi.fn(next);
	chain.select = vi.fn(next);
	chain.count = vi.fn(next);
	chain.groupBy = vi.fn(() => Promise.resolve(rows));
	const knex = vi.fn(() => chain) as unknown as {
		(name: string): typeof chain;
		raw: (sql: string) => string;
	};
	knex.raw = (sql: string) => sql;
	return knex;
}

/**
 * Build a viewer `ArchiveContext` populated with a stub `ArchiveManager`
 * that returns an accessor backed by the supplied knex aggregate result.
 * @param archiveId - Identifier the cache will use as its map key.
 * @param rows - Aggregate rows the underlying GROUP BY should produce.
 */
function makeContext(
	archiveId: string,
	rows: Array<{ canonicalId: number; count: number }>,
): ArchiveContext {
	const knex = makeKnex(rows);
	const accessor = {
		getKnex: () => knex,
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

afterEach(() => {
	vi.clearAllMocks();
});

describe('getCachedReferrerCounts', () => {
	it('returns a Map keyed by canonical page id with anchor counts as values', async () => {
		// The CLI / MCP path uses a per-row subquery — this verifies the
		// viewer Map carries the exact same numbers (canonical id resolved
		// + counted) so the precompute path is semantically equivalent.
		const context = makeContext('archive_a', [
			{ canonicalId: 10, count: 3 },
			{ canonicalId: 20, count: 7 },
		]);

		const map = await getCachedReferrerCounts(context);
		expect(map.get(10)).toBe(3);
		expect(map.get(20)).toBe(7);
		expect(map.has(30)).toBe(false);
	});

	it('reuses the cached map across multiple calls without re-running the GROUP BY', async () => {
		// Page-link view paging triggers `listPageLinks` per click. Without
		// caching, every click re-issues the multi-second aggregate. We
		// observe re-execution via the `manager.get` spy on the context:
		// only the cache miss path resolves an accessor.
		const context = makeContext('archive_b', [{ canonicalId: 1, count: 5 }]);

		await getCachedReferrerCounts(context);
		await getCachedReferrerCounts(context);
		await getCachedReferrerCounts(context);

		expect(context.manager.get).toHaveBeenCalledTimes(1);
	});

	it('shares an in-flight computation across concurrent callers', async () => {
		// Concurrent paging clicks must not race into duplicate aggregates.
		let resolveRows:
			| ((r: Array<{ canonicalId: number; count: number }>) => void)
			| undefined;
		const pending = new Promise<Array<{ canonicalId: number; count: number }>>(
			(resolve) => {
				resolveRows = resolve;
			},
		);
		const chain: Record<string, unknown> = {};
		const next = () => chain;
		chain.join = vi.fn(next);
		chain.select = vi.fn(next);
		chain.count = vi.fn(next);
		chain.groupBy = vi.fn(() => pending);
		const knex = Object.assign(
			vi.fn(() => chain),
			{ raw: (s: string) => s },
		);
		const accessor = { getKnex: () => knex } as unknown as ArchiveAccessor;
		const manager = {
			get: vi.fn().mockReturnValue(accessor),
		} as unknown as ArchiveManager;
		const context: ArchiveContext = {
			manager,
			archiveId: 'archive_c',
			filePath: '/fake/c.nitpicker',
			mode: 'archive',
			crawlerLockHolder: null,
		};

		const p1 = getCachedReferrerCounts(context);
		const p2 = getCachedReferrerCounts(context);
		const p3 = getCachedReferrerCounts(context);
		resolveRows?.([{ canonicalId: 1, count: 1 }]);
		const [m1, m2, m3] = await Promise.all([p1, p2, p3]);
		expect(m1).toBe(m2);
		expect(m2).toBe(m3);
		expect(chain.groupBy).toHaveBeenCalledTimes(1);
	});

	it('returns null in stub mode so the route falls back to the per-row subquery for live data', async () => {
		// Stub-mode archives mutate underneath the viewer. A cached
		// Map would freeze counts at first hit. We explicitly return
		// `null` so `register-page-links-route` omits the precomputed
		// option and `listPageLinks` uses its live correlated subquery
		// path.
		const stubContext: ArchiveContext = {
			...makeContext('archive_stub', [{ canonicalId: 1, count: 99 }]),
			mode: 'stub',
		};

		const result = await getCachedReferrerCounts(stubContext);
		expect(result).toBeNull();
		// And the manager / accessor must not have been resolved — the
		// build path should be skipped entirely.
		expect(stubContext.manager.get).not.toHaveBeenCalled();
	});

	it('drops a rejected entry so the next request retries', async () => {
		// Cached rejections would freeze the page-links view forever on a
		// transient SQL error — explicitly avoided.
		const chain: Record<string, unknown> = {};
		const next = () => chain;
		chain.join = vi.fn(next);
		chain.select = vi.fn(next);
		chain.count = vi.fn(next);
		const failure = new Error('transient knex failure');
		chain.groupBy = vi
			.fn()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce([{ canonicalId: 99, count: 4 }]);
		const knex = Object.assign(
			vi.fn(() => chain),
			{ raw: (s: string) => s },
		);
		const accessor = { getKnex: () => knex } as unknown as ArchiveAccessor;
		const manager = {
			get: vi.fn().mockReturnValue(accessor),
		} as unknown as ArchiveManager;
		const context: ArchiveContext = {
			manager,
			archiveId: 'archive_retry',
			filePath: '/fake/retry.nitpicker',
			mode: 'archive',
			crawlerLockHolder: null,
		};

		await expect(getCachedReferrerCounts(context)).rejects.toThrow(
			'transient knex failure',
		);
		const recovered = await getCachedReferrerCounts(context);
		expect(recovered.get(99)).toBe(4);
	});
});
