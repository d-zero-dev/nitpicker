import fs from 'node:fs/promises';

import { pathExists } from './path-exists.js';

/**
 * Remove a single archive cache entry (one directory previously resolved by
 * {@link import('./resolve-archive-cache-dir.js').resolveArchiveCacheDir}).
 *
 * Deliberately scoped to exactly `cacheDir` — it never touches sibling
 * entries under the same cache root (in particular, the `@nitpicker/core`
 * analyze `table` cache is never archive-scoped and must survive a
 * per-archive clear).
 * @param cacheDir - Absolute path to the single cache entry to remove.
 * @returns `true` if `cacheDir` existed and was removed, `false` if it was
 *   already absent.
 * @example
 * ```ts
 * const cacheKey = await computeArchiveCacheKey(archivePath);
 * const cacheDir = resolveArchiveCacheDir(cacheRoot, cacheKey, archivePath);
 * const removed = await clearArchiveCacheEntry(cacheDir);
 * ```
 */
export async function clearArchiveCacheEntry(cacheDir: string): Promise<boolean> {
	const existedBefore = await pathExists(cacheDir);
	await fs.rm(cacheDir, { recursive: true, force: true });
	return existedBefore;
}
