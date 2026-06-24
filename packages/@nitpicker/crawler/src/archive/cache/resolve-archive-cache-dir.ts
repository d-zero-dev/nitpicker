import path from 'node:path';

/**
 * Build the absolute path to a single archive's cache directory.
 *
 * The directory name is `<cacheKey>-<safeBasename>`:
 *
 * - `cacheKey` carries the freshness signal (size/mtime/ctime) and is
 *   what actually drives cache hit vs miss.
 * - `safeBasename` is appended purely so a human running `ls` on the
 *   cache root can recognise which archive an entry belongs to. It is
 *   NOT used to disambiguate keys — two archives with identical inode
 *   metadata (e.g. an identical copy under a different name) intentionally
 *   share an entry under the first basename that landed there.
 *
 * The basename is sanitised: anything outside `[A-Za-z0-9._-]` becomes
 * `_`. This keeps the path portable across filesystems (no spaces,
 * unicode normalisation surprises, Windows-reserved chars) and removes
 * any chance that a crafted archive name could escape the cache root
 * (e.g. via `..` or path separators), independent of the upstream
 * `path.basename` call that already drops directory components.
 * @param cacheRoot - Absolute path returned by `getArchiveCacheRoot()`.
 * @param cacheKey - The freshness key from `computeArchiveCacheKey()`.
 * @param archivePath - Absolute path to the source `.nitpicker` file;
 *   only its basename contributes to the cache entry name.
 * @returns Absolute path to the per-archive cache directory.
 */
export function resolveArchiveCacheDir(
	cacheRoot: string,
	cacheKey: string,
	archivePath: string,
): string {
	const rawBasename = path.basename(archivePath, path.extname(archivePath));
	const safeBasename = rawBasename.replaceAll(/[^\w.-]+/g, '_').slice(0, 80);
	const dirName = safeBasename.length > 0 ? `${cacheKey}-${safeBasename}` : cacheKey;
	return path.resolve(cacheRoot, dirName);
}
