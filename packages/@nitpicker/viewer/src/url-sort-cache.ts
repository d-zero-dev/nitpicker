import type { ArchiveContext } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';

import { prepareUrlSortTempTable } from '@nitpicker/query';

/**
 * Subdirectory inside an archive's tar-cache directory where precomputed
 * artefacts live — mirrors `precomputed-disk-cache.ts`'s convention so both
 * caches roll together when the archive's content-hash key changes.
 */
const PRECOMPUTED_DIR_NAME = 'precomputed';

/** Filename of the persisted ranked-URL stream. */
const CACHE_FILE_NAME = 'url-sort-ranks.jsonl';

/**
 * Prepares the viewer's URL-sort TEMP TABLE, replaying a prior run's output
 * from disk when available instead of re-running the external merge sort.
 *
 * **Why not the existing `getOrComputeOnDisk`**: that helper buffers the
 * whole artefact as one JSON string before writing/parsing it, which is
 * fine for a `SummaryResult` or a handful of `IsolatedComponent`s but
 * defeats the point here — a million-plus-URL archive's rank list is
 * exactly the payload the external sort ({@link
 * import('@nitpicker/query').externalSortUrls}) was built to avoid holding
 * in memory all at once. This cache streams JSON-Lines through
 * `readline`/`createWriteStream` instead, one row at a time on both the
 * write and replay paths, so a Ctrl-C / re-open skips the sort without
 * reintroducing the memory spike it was built to avoid.
 *
 * **Stub-mode bypass**: mirrors `summary-cache.ts` / `isolated-clusters-cache.ts`
 * — a live crawl stub's `pages`/`resources` are still growing, so a cached
 * rank list would go stale mid-crawl. Stub mode always re-sorts.
 *
 * A cache write failure (e.g. disk full) does not fail viewer startup: the
 * TEMP TABLE is still built from the live sort, only the on-disk replay for
 * the *next* time is skipped.
 * @param context - The viewer's per-request archive context.
 * @param onProgress - Forwarded to {@link prepareUrlSortTempTable} on a cache miss.
 * @example
 * await prepareCachedUrlSortTempTable(context, (msg) => lanes.update(0, msg));
 */
export async function prepareCachedUrlSortTempTable(
	context: ArchiveContext,
	onProgress?: (message: string) => void,
): Promise<void> {
	const accessor = context.manager.get(context.archiveId);
	if (context.mode === 'stub') {
		await prepareUrlSortTempTable(accessor, { onProgress });
		return;
	}

	const cacheFile = path.join(accessor.tmpDir, PRECOMPUTED_DIR_NAME, CACHE_FILE_NAME);
	if (await fileExists(cacheFile)) {
		onProgress?.('Sorting URLs: loading cached order from a previous run…');
		await prepareUrlSortTempTable(accessor, { rankedUrls: readCachedRanks(cacheFile) });
		return;
	}

	await sortAndCache(accessor, cacheFile, onProgress);
}

/**
 * Checks whether a file exists, without throwing on `ENOENT`.
 * @param filePath - Path to probe.
 * @returns Whether the file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Streams `{url, rank}` pairs out of a previously persisted cache file.
 * @param cacheFile - Absolute path to the JSON-Lines cache file.
 * @yields {{url: string, rank: number}} Each cached ranked row, in file order
 *   (already ascending rank).
 */
async function* readCachedRanks(cacheFile: string): AsyncGenerator<{
	url: string;
	rank: number;
}> {
	const lines = readline.createInterface({
		input: createReadStream(cacheFile, 'utf8'),
		crlfDelay: Infinity,
	});
	for await (const line of lines) {
		if (line.length === 0) continue;
		yield JSON.parse(line) as { url: string; rank: number };
	}
}

/**
 * Runs a fresh external sort while streaming its output to the cache file,
 * so a subsequent viewer start can replay it instead of re-sorting.
 * @param accessor - The opened archive accessor.
 * @param cacheFile - Absolute path the cache should end up at once complete.
 * @param onProgress - Forwarded to {@link prepareUrlSortTempTable}.
 */
async function sortAndCache(
	accessor: ArchiveAccessor,
	cacheFile: string,
	onProgress?: (message: string) => void,
): Promise<void> {
	const dir = path.dirname(cacheFile);
	await fs.mkdir(dir, { recursive: true });
	const tmpFile = path.join(dir, `.${path.basename(cacheFile)}.${process.pid}.tmp`);
	const stream = createWriteStream(tmpFile, 'utf8');
	// A write-stream error (e.g. disk full) must not take down the sort
	// itself — the TEMP TABLE the viewer actually needs is built from
	// `prepareUrlSortTempTable`'s own insert path, independent of this
	// stream. Once broken, stop writing rather than let further `.write()`
	// calls throw or silently queue against a dead stream.
	let cacheWritable = true;
	// Registered once, up front, rather than raced in only after `.end()`:
	// Node's `end(callback)` callback can fire before the `'error'` event
	// does when the failure happens on the final buffered flush (observed
	// with Node 24), so checking `cacheWritable` only after `await`ing the
	// `end()` callback can still see a stale `true` and promote a truncated
	// file. Listening from the start means whichever of `'error'` or
	// `'finish'` fires first is still correctly observed below.
	const errorPromise = new Promise<void>((resolve) => {
		stream.once('error', () => {
			cacheWritable = false;
			resolve();
		});
	});

	try {
		await prepareUrlSortTempTable(accessor, {
			onProgress,
			onRanked: (url, rank) => {
				if (cacheWritable) {
					stream.write(`${JSON.stringify({ url, rank })}\n`);
				}
			},
		});
	} catch (error) {
		stream.destroy();
		await removeQuietly(tmpFile);
		throw error;
	}

	if (!cacheWritable) {
		await removeQuietly(tmpFile);
		return;
	}
	const finishPromise = new Promise<void>((resolve) => {
		stream.once('finish', () => resolve());
	});
	stream.end();
	await Promise.race([finishPromise, errorPromise]);
	if (!cacheWritable) {
		await removeQuietly(tmpFile);
		return;
	}
	try {
		await fs.rename(tmpFile, cacheFile);
	} catch {
		// Persisting the cache is an optimization, not a correctness
		// requirement — the TEMP TABLE is already built. Next start just
		// pays the sort cost again, which is the pre-cache baseline.
		await removeQuietly(tmpFile);
	}
}

/**
 * Removes a file, swallowing any error (missing file, permission denied on
 * an unwritable cache directory, etc). Cleaning up a scratch file is a
 * best-effort courtesy, not a correctness requirement — a failure here must
 * never mask or replace the caller's own success/failure outcome.
 * @param filePath - Path to remove.
 */
async function removeQuietly(filePath: string): Promise<void> {
	try {
		await fs.rm(filePath, { force: true });
	} catch {
		// Best-effort — see JSDoc.
	}
}
