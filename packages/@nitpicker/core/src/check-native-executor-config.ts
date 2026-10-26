import { nativeBinding } from './native-binding.js';

/**
 * Builds the addon's thread pool from its environment settings now, so an
 * invalid value fails before any work starts instead of at the first native
 * call that needs the pool.
 *
 * - `NITPICKER_NATIVE_THREADS`: threads of the pool. Unset: rayon's default
 *   (`RAYON_NUM_THREADS`, else the number of logical cores).
 * - `NITPICKER_NATIVE_CONCURRENCY`: asynchronous native calls (match-selector,
 *   search-html, template classification) that run at once. Unset: 1. A call
 *   over the limit waits its turn; it is never refused.
 *
 * Both are read once, when the pool is first built; changing them afterwards
 * has no effect in that process.
 * @throws {Error} With code `InvalidArg`, naming the variable and its value,
 *   when a setting is not a positive integer.
 * @example
 * ```ts
 * checkNativeExecutorConfig(); // throws before the crawl starts if the env is wrong
 * ```
 */
export function checkNativeExecutorConfig(): void {
	nativeBinding.checkNativeExecutorConfig();
}
