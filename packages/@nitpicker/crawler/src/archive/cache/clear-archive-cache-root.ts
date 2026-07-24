import fs from 'node:fs/promises';

import { pathExists } from './path-exists.js';

/**
 * Remove an entire archive cache root, including every tar-cache entry and
 * any sibling directory living under it (e.g. the `@nitpicker/core` analyze
 * `table` cache, which is resolved as a child of the same root).
 *
 * Pure: takes `cacheRoot` as a parameter and never resolves it itself, so
 * tests can point it at a throwaway directory instead of the real OS temp
 * cache. Mirrors the "manual `rm -rf` is safe" contract already documented
 * for the tar cache (ARCHITECTURE.md) — no confirmation, no lock check.
 *
 * Why not lock-aware: a concurrent `extractArchiveToCache` elsewhere may be
 * holding `<cacheDir>.lock` / writing `<cacheDir>.staging` inside this root
 * when it is removed, which can surface as an ENOENT in that extraction (or,
 * rarely, a second extractor racing into a freshly recreated `.staging`
 * path). This is the same exposure a manual `rm -rf` already has today —
 * this function does not add new risk, it just makes that pre-existing,
 * accepted risk reachable via a single explicit command.
 * @param cacheRoot - Absolute path to the cache root to remove.
 * @returns `true` if `cacheRoot` existed and was removed, `false` if it was
 *   already absent.
 * @example
 * ```ts
 * const removed = await clearArchiveCacheRoot(getArchiveCacheRoot());
 * ```
 */
export async function clearArchiveCacheRoot(cacheRoot: string): Promise<boolean> {
	const existedBefore = await pathExists(cacheRoot);
	await fs.rm(cacheRoot, { recursive: true, force: true });
	return existedBefore;
}
