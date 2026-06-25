/* eslint-disable @typescript-eslint/require-await -- spec uses async arrow fixtures whose body is intentionally synchronous to model 'instant load'. */

import { describe, expect, it } from 'vitest';

import { createPromiseLru } from './promise-lru.js';

describe('createPromiseLru', () => {
	it('returns the cached promise for repeated keys (no double load)', async () => {
		// The whole point of the cache: one load per key, period.
		const lru = createPromiseLru<string, number>({ maxEntries: 4 });
		let calls = 0;
		const load = async () => {
			calls++;
			return 42;
		};

		expect(await lru.getOrLoad('a', load)).toBe(42);
		expect(await lru.getOrLoad('a', load)).toBe(42);
		expect(await lru.getOrLoad('a', load)).toBe(42);
		expect(calls).toBe(1);
	});

	it('shares an in-flight load across concurrent getOrLoad calls', async () => {
		// Multiple promise consumers hitting the cache mid-load must
		// converge on the single in-flight promise — without dedup, a
		// 30s aggregate could be issued N times for N concurrent
		// requests.
		let resolveLoad: ((v: number) => void) | undefined;
		const pending = new Promise<number>((resolve) => {
			resolveLoad = resolve;
		});
		let loadCalls = 0;
		const load = () => {
			loadCalls++;
			return pending;
		};

		const lru = createPromiseLru<string, number>({ maxEntries: 4 });
		const p1 = lru.getOrLoad('a', load);
		const p2 = lru.getOrLoad('a', load);
		const p3 = lru.getOrLoad('a', load);
		expect(loadCalls).toBe(1);
		resolveLoad?.(7);
		expect(await Promise.all([p1, p2, p3])).toEqual([7, 7, 7]);
	});

	it('drops a rejected entry so the next call retries', async () => {
		// Cached rejections are sticky and frustrating — a transient
		// SQL hiccup must not freeze the viewer for the whole session.
		const lru = createPromiseLru<string, number>({ maxEntries: 4 });
		let calls = 0;
		const load = async () => {
			calls++;
			if (calls === 1) {
				throw new Error('transient');
			}
			return 99;
		};

		await expect(lru.getOrLoad('a', load)).rejects.toThrow('transient');
		expect(await lru.getOrLoad('a', load)).toBe(99);
		expect(calls).toBe(2);
	});

	it('evicts the least-recently-used entry — not the first-inserted — past the budget', async () => {
		// FIFO eviction (the bug fix this helper exists for): without
		// promote-on-read, a long viewer session that keeps hitting
		// the FIRST opened archive would evict it the moment a 4th
		// archive is opened, while colder more-recently-inserted
		// archives survive. We promote on read so the hottest entry
		// is the youngest in iteration order.
		const lru = createPromiseLru<string, string>({ maxEntries: 3 });
		await lru.getOrLoad('A', async () => 'A');
		await lru.getOrLoad('B', async () => 'B');
		await lru.getOrLoad('C', async () => 'C');

		// Touch A — it becomes most-recently-used. B is now the oldest.
		await lru.getOrLoad('A', async () => {
			throw new Error('should not call load on cache hit');
		});

		// Insert D, overflowing the cap. The oldest (B) must be the
		// one evicted; A and C survive.
		await lru.getOrLoad('D', async () => 'D');

		// Confirm A and C are still cached BEFORE re-fetching B —
		// because re-fetching B would itself trigger another eviction
		// (size goes 3 → 4 → 3) and the LRU among {C, A, D} is C, so
		// the second insert would legitimately drop C. The test is
		// "after one overflow B is the only victim", not "B stays
		// evictable across further inserts".
		await lru.getOrLoad('A', async () => {
			throw new Error('A was evicted unexpectedly');
		});
		await lru.getOrLoad('C', async () => {
			throw new Error('C was evicted unexpectedly');
		});

		let bLoadCalls = 0;
		await lru.getOrLoad('B', async () => {
			bLoadCalls++;
			return 'B-recomputed';
		});
		expect(bLoadCalls).toBe(1);
	});

	it('settles to maxEntries even when a burst overshoots by more than one', async () => {
		// Defensive: when concurrent inserts pile up past the cap the
		// while-loop must drain back to maxEntries, not stop after a
		// single delete.
		const lru = createPromiseLru<string, string>({ maxEntries: 2 });
		// Pre-seed past the cap by hand: cheat via the public API and
		// rely on the post-insert sweep.
		await lru.getOrLoad('1', async () => '1');
		await lru.getOrLoad('2', async () => '2');
		await lru.getOrLoad('3', async () => '3');
		await lru.getOrLoad('4', async () => '4');
		// After four inserts with cap 2, only the last two survive.
		let firstLoadCalls = 0;
		await lru.getOrLoad('1', async () => {
			firstLoadCalls++;
			return '1-recomputed';
		});
		await lru.getOrLoad('2', async () => {
			firstLoadCalls++;
			return '2-recomputed';
		});
		expect(firstLoadCalls).toBe(2);
	});

	it('rejects maxEntries < 1 at construction time so callers cannot ship a never-caching cache', () => {
		expect(() => createPromiseLru<string, number>({ maxEntries: 0 })).toThrow(RangeError);
	});
});
