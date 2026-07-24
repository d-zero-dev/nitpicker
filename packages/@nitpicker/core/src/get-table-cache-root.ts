import path from 'node:path';

import { getArchiveCacheRoot } from '@nitpicker/crawler';

/**
 * Resolve the storage location for the analyze command's scratch `table`
 * cache (per-page axe results, cleared at the start of every `analyze` run).
 *
 * Defined as a child of {@link getArchiveCacheRoot} so that
 * `NITPICKER_TAR_CACHE_DIR` — which already redirects the tar-extraction
 * cache — consistently redirects this cache too, instead of the two caches
 * silently splitting across different roots.
 * @returns Absolute path to the `table` cache directory. The `Cache` class
 *   creates a further subdirectory under this path named after its `name`
 *   argument.
 * @example
 * ```ts
 * const cache = new Cache('nitpicker-axe', getTableCacheRoot());
 * await cache.clear();
 * ```
 */
export function getTableCacheRoot(): string {
	return path.join(getArchiveCacheRoot(), 'table');
}
