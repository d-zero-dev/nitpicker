import process from 'node:process';

/**
 * Runs `work` once and measures its wall-clock time.
 * @template T
 * @param {() => T | Promise<T>} work - The work to time.
 * @returns {Promise<{ ms: number; value: T }>} Elapsed milliseconds and what
 *   `work` returned.
 * @example
 * const { ms, value: result } = await measureMs(() => searchHtml(accessor, options));
 */
export async function measureMs(work) {
	const start = process.hrtime.bigint();
	const value = await work();
	return { ms: Number(process.hrtime.bigint() - start) / 1e6, value };
}
