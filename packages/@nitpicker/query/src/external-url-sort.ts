import type { ArchiveAccessor } from '@nitpicker/crawler';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { mergeSortedUrlChunks } from './merge-sorted-url-chunks.js';
import { readUrlChunks } from './read-url-chunks.js';
import { writeSortedUrlChunk } from './write-sorted-url-chunk.js';

/** Rows read from `pages`/`resources` per chunk during the split phase. */
const READ_CHUNK_SIZE = 50_000;

/** How often (in merged rows) to report merge-phase progress. */
const MERGE_PROGRESS_INTERVAL = 100_000;

/**
 * Creates a temp directory via `mkdtemp`, tagged with `Symbol.asyncDispose`
 * so the caller can `await using` it instead of a manual `try`/`finally`
 * around `fs.rm(dir, { recursive: true, force: true })`.
 * @param dir - Parent directory the temp directory is created under.
 * @param prefix - Prefix forwarded to `fs.mkdtemp`.
 */
async function mkdtempDisposable(
	dir: string,
	prefix: string,
): Promise<{ path: string } & AsyncDisposable> {
	const dirPath = await fs.mkdtemp(path.join(dir, prefix));
	return {
		path: dirPath,
		async [Symbol.asyncDispose]() {
			await fs.rm(dirPath, { recursive: true, force: true });
		},
	};
}

/**
 * Options for {@link externalSortUrls}.
 */
export interface ExternalSortUrlsOptions {
	/**
	 * Rows read per `pages`/`resources` chunk. Exposed for tests that need to
	 * force multiple chunks (and therefore exercise the K-way merge) without
	 * needing archive-scale fixtures; production callers should omit it and
	 * use the default.
	 */
	readChunkSize?: number;
	/**
	 * Called with a human-readable status line as the sort progresses. On a
	 * million-plus-URL archive the split + merge phases can each take
	 * multiple minutes with no other observable output, so callers running
	 * this from a CLI/viewer startup path should wire this to `console.log`
	 * — otherwise the process looks hung.
	 */
	onProgress?: (message: string) => void;
}

/**
 * Sorts every distinct URL across `pages` and `resources` into natural URL
 * order using an external merge sort, without holding more than one
 * read-chunk's worth of parsed URLs in memory at a time.
 *
 * Archives with a million-plus URLs make an in-memory "parse everything,
 * then sort" pass expensive enough to exhaust the default V8 heap (an
 * 11 GB / ~1.5M URL archive OOMs at startup with the whole-archive
 * approach). Splitting the read into `id`-keyset chunks, sorting and
 * spilling each chunk to a temp file, then K-way merging the sorted files
 * keeps peak memory bounded by chunk size instead of archive size, at the
 * cost of extra disk I/O and wall-clock time.
 * @param accessor - The opened archive accessor.
 * @param onRow - Called once per distinct URL, in ascending natural-sort
 *   order, with its 0-based rank. The caller is expected to batch these into
 *   the destination (e.g. grouped `INSERT`s) rather than collecting them all
 *   first — that would defeat the point of the external sort.
 * @param options - See {@link ExternalSortUrlsOptions}.
 * @example
 * let rank = 0;
 * await externalSortUrls(
 *   accessor,
 *   async (url) => { await insertRankedRow(url, rank++); },
 *   { onProgress: (message) => console.log(message) },
 * );
 */
export async function externalSortUrls(
	accessor: ArchiveAccessor,
	onRow: (url: string, rank: number) => Promise<void>,
	options: ExternalSortUrlsOptions = {},
): Promise<void> {
	const { readChunkSize = READ_CHUNK_SIZE, onProgress } = options;
	// `mkdtemp` (not a fixed `<tmpDir>/url-sort-tmp` path) so two concurrent
	// callers on the same non-read-only accessor — e.g. `listPages` and
	// `listExternalLinks` both default to `sortBy: 'url'` and can race before
	// `ensureUrlSortTempTable`'s `preparedConnections` guard has been
	// populated — get distinct scratch directories instead of interleaving
	// writes into (and one prematurely `rm -rf`-ing) the other's chunk files.
	await using tmpDirHandle = accessor.readOnly
		? await mkdtempDisposable(os.tmpdir(), 'nitpicker-url-sort-')
		: await mkdtempDisposable(accessor.tmpDir, 'url-sort-tmp-');
	const tmpDir = tmpDirHandle.path;

	// A row-count estimate up front — cheap even on a multi-GB archive,
	// since `COUNT(*)` on SQLite is a single index-only scan — is what
	// turns the progress lines below into an actual percentage instead of
	// a raw counter with no sense of how much work remains.
	const knex = accessor.getKnex();
	const [pagesCount, resourcesCount] = await Promise.all([
		knex('content_items').count<{ count: number }[]>({ count: '*' }),
		knex('resource_items').count<{ count: number }[]>({ count: '*' }),
	]);
	const totalRows =
		Number(pagesCount[0]?.count ?? 0) + Number(resourcesCount[0]?.count ?? 0);
	const percentOf = (done: number): number =>
		totalRows > 0 ? Math.min(100, Math.floor((done / totalRows) * 100)) : 100;

	const chunkFiles: string[] = [];
	let rowsReadSoFar = 0;
	for (const table of ['pages', 'resources'] as const) {
		let tableRows = 0;
		for await (const urls of readUrlChunks(accessor, table, readChunkSize)) {
			chunkFiles.push(await writeSortedUrlChunk(urls, tmpDir, chunkFiles.length));
			tableRows += urls.length;
			rowsReadSoFar += urls.length;
			onProgress?.(
				`Sorting URLs: reading ${table} — ${tableRows.toLocaleString()} rows ` +
					`(${percentOf(rowsReadSoFar)}% overall, ${chunkFiles.length} chunk file(s) so far)`,
			);
		}
	}
	onProgress?.(`Sorting URLs: merging ${chunkFiles.length} chunk file(s)…`);

	let rank = 0;
	let rowsMergedSoFar = 0;
	for await (const key of mergeSortedUrlChunks(chunkFiles, () => {
		rowsMergedSoFar++;
	})) {
		await onRow(key.original, rank);
		rank++;
		if (rank % MERGE_PROGRESS_INTERVAL === 0) {
			onProgress?.(
				`Sorting URLs: merging — ${rank.toLocaleString()} distinct URLs so far ` +
					`(${percentOf(rowsMergedSoFar)}%)`,
			);
		}
	}
	onProgress?.(`Sorting URLs: done — ${rank.toLocaleString()} distinct URLs ranked`);
}
