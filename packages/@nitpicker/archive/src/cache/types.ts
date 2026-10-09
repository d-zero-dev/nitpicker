/**
 * Classification of a top-level entry found directly under an archive cache
 * root ({@link import('./get-archive-cache-root.js').getArchiveCacheRoot}).
 *
 * - `'tar-cache'`: a per-archive extraction produced by
 *   {@link import('./resolve-archive-cache-dir.js').resolveArchiveCacheDir}
 *   (`<cacheKey>-<safeBasename>`).
 * - `'orphan'`: a `.staging` or `.corrupt.<pid>.<n>` leftover from an
 *   interrupted {@link import('./extract-archive-to-cache.js').extractArchiveToCache}
 *   run (see that file's quarantine/staging logic), or a directory literally
 *   named `table` — the scratch cache earlier versions kept beside the
 *   tar-cache entries, which nothing reads or writes any more.
 * - `'unknown'`: anything else (a stray file, a foreign directory a user
 *   dropped into the cache root).
 *
 * `'tar-cache'` and the bare `table` orphan cannot collide:
 * `resolveArchiveCacheDir` always prefixes the cache key (digits and hyphens),
 * so a tar-cache directory name is never the bare literal `table`.
 */
export type ArchiveCacheEntryKind = 'tar-cache' | 'orphan' | 'unknown';

/** A single top-level entry found under an archive cache root. */
export interface ArchiveCacheEntry {
	/** How this entry was classified by name pattern. */
	readonly kind: ArchiveCacheEntryKind;
	/** Base name of the entry (its final path segment). */
	readonly name: string;
	/** Absolute path to the entry. */
	readonly path: string;
	/** Total size in bytes of all regular files found under this entry (recursive for directories). */
	readonly sizeBytes: number;
	/** Most recent mtime (epoch ms) found among the entry's files, or the entry's own mtime if it has none. */
	readonly mtimeMs: number;
}
