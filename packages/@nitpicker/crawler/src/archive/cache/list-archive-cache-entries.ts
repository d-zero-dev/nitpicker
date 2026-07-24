import type { ArchiveCacheEntry, ArchiveCacheEntryKind } from './types.js';

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * List the top-level entries found directly under an archive cache root,
 * with a recursive size total and the most recent mtime found in each.
 *
 * Pure: takes `cacheRoot` as a parameter and never resolves it itself (see
 * {@link import('./get-archive-cache-root.js').getArchiveCacheRoot} for the
 * production root), so tests can point it at a throwaway directory instead
 * of the real OS temp cache.
 *
 * Symbolic links are reported but never followed, both at the top level and
 * while walking a directory's contents — this avoids escaping `cacheRoot`
 * and crashing on dangling links.
 * @param cacheRoot - Absolute path to the cache root to inspect.
 * @returns One entry per top-level child of `cacheRoot`, in `fs.readdir`
 *   order. Returns `[]` if `cacheRoot` does not exist.
 * @example
 * ```ts
 * const entries = await listArchiveCacheEntries(getArchiveCacheRoot());
 * const totalBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
 * ```
 */
export async function listArchiveCacheEntries(
	cacheRoot: string,
): Promise<ArchiveCacheEntry[]> {
	let topLevel;
	try {
		topLevel = await fs.readdir(cacheRoot, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}
		throw error;
	}

	const entries: ArchiveCacheEntry[] = [];
	for (const dirent of topLevel) {
		const entryPath = path.join(cacheRoot, dirent.name);
		if (dirent.isSymbolicLink()) {
			entries.push({
				kind: 'unknown',
				name: dirent.name,
				path: entryPath,
				sizeBytes: 0,
				mtimeMs: 0,
			});
			continue;
		}
		if (dirent.isDirectory()) {
			const { sizeBytes, mtimeMs } = await computeDirectoryStats(entryPath);
			entries.push({
				kind: classifyEntryName(dirent.name),
				name: dirent.name,
				path: entryPath,
				sizeBytes,
				mtimeMs,
			});
			continue;
		}
		const stat = await fs.stat(entryPath);
		entries.push({
			kind: 'unknown',
			name: dirent.name,
			path: entryPath,
			sizeBytes: stat.size,
			mtimeMs: stat.mtimeMs,
		});
	}
	return entries;
}

/**
 * Matches the corrupt-quarantine suffix `extractArchiveToCache` appends
 * (`${cacheDir}.corrupt.${pid}.${counter}`, both segments always numeric —
 * see `quarantineHalfPopulatedCacheDir` in `extract-archive-to-cache.ts`).
 * Anchored and numeric-specific rather than a loose `includes('.corrupt.')`
 * so an archive whose own (sanitized) basename merely contains the
 * substring `.corrupt.` — e.g. `my.corrupt.report.nitpicker` — is not
 * misclassified as an orphan and offered up for deletion by `cache list`.
 */
const CORRUPT_QUARANTINE_SUFFIX = /\.corrupt\.\d+\.\d+$/;

/**
 * Classify a cache-root child by name pattern alone (no filesystem access).
 *
 * This is a heuristic: `.staging`/corrupt-quarantine suffixes are appended
 * by `extractArchiveToCache` onto an existing tar-cache dir name, so an
 * archive whose own sanitized basename happens to end in exactly one of
 * these literal suffixes is indistinguishable from a real orphan by name
 * alone. Disambiguating fully would require re-deriving each entry's
 * expected name from its source archive, which `list`/`clear` (by design,
 * see grill-me scope) never has access to. Accepted as a rare, low-cost
 * misclassification.
 * @param name - Base name of the top-level entry.
 */
function classifyEntryName(name: string): ArchiveCacheEntryKind {
	if (name === 'table') {
		return 'table';
	}
	if (name.endsWith('.staging') || CORRUPT_QUARANTINE_SUFFIX.test(name)) {
		return 'orphan';
	}
	return 'tar-cache';
}

/**
 * Recursively sum file sizes and find the most recent mtime under a
 * directory. Symbolic links are neither followed nor counted.
 * @param dirPath - Absolute path to the directory to walk.
 */
async function computeDirectoryStats(
	dirPath: string,
): Promise<{ sizeBytes: number; mtimeMs: number }> {
	let sizeBytes = 0;
	let mtimeMs = 0;
	const children = await fs.readdir(dirPath, { recursive: true, withFileTypes: true });
	for (const child of children) {
		if (!child.isFile()) {
			continue;
		}
		const childPath = path.join(child.parentPath, child.name);
		const stat = await fs.stat(childPath);
		sizeBytes += stat.size;
		mtimeMs = Math.max(mtimeMs, stat.mtimeMs);
	}
	if (mtimeMs === 0) {
		const dirStat = await fs.stat(dirPath);
		mtimeMs = dirStat.mtimeMs;
	}
	return { sizeBytes, mtimeMs };
}
