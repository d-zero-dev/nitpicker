import process from 'node:process';

/**
 * Runs synchronous `work` once and measures its wall-clock time, without
 * the microtask hop an `await` adds — for per-item timings summed over
 * many items (one hash per snapshot), where that hop would add up to a
 * visible share of a microsecond-scale native call.
 * @template T
 * @param {() => T} work - The synchronous work to time.
 * @returns {{ ms: number; value: T }} Elapsed milliseconds and what `work`
 *   returned.
 * @example
 * const { ms, value: hash } = measureSyncMs(() => computeBodyHash(bytes));
 */
export function measureSyncMs(work) {
	const start = process.hrtime.bigint();
	const value = work();
	return { ms: Number(process.hrtime.bigint() - start) / 1e6, value };
}
