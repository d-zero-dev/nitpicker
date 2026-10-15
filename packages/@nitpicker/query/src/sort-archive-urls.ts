import type { ArchiveAccessor } from '@nitpicker/archive/archive-accessor';

import { computeUrlSortRanks } from '@nitpicker/archive/url-sort/compute-url-sort-ranks';

import { readUrlChunks } from './read-url-chunks.js';

/** Rows read from `pages`/`resources` per chunk. */
const READ_CHUNK_SIZE = 50_000;

/** How often (in emitted rows) to report progress while handing out ranks. */
const EMIT_PROGRESS_INTERVAL = 100_000;

/**
 * Options for {@link sortArchiveUrls}.
 */
export interface SortArchiveUrlsOptions {
	/**
	 * Rows read per `pages`/`resources` chunk. Exposed for tests that need to
	 * force several chunks without archive-scale fixtures; production callers
	 * should omit it.
	 */
	readChunkSize?: number;
	/**
	 * Called with a human-readable status line as the sort progresses. On a
	 * million-plus-URL archive the reading and ranking phases take long enough
	 * that a caller running this from a CLI or viewer path should print these,
	 * or the process looks hung.
	 */
	onProgress?: (message: string) => void;
}

/**
 * Sorts every distinct URL across `pages` and `resources` into natural URL
 * order and hands each out with its rank.
 *
 * The URLs are read in `id`-keyset chunks and de-duplicated as strings (a URL
 * can sit in both tables), then ranked in one native call
 * (`computeUrlSortRanks`: each URL parsed once, sorted on the native thread
 * pool). Memory is proportional to the distinct URLs' total length — the
 * strings here, their UTF-8 bytes and the native keys — not to the archive's
 * size, and the sort does not spill to disk: peak RSS is about five times
 * that total (1.59M distinct URLs of 479 MiB in all peaked at 2.5 GB, the
 * reading connection included).
 * @param accessor - The opened archive accessor.
 * @param onRow - Called once per distinct URL, in ascending natural-sort
 *   order, with its 0-based rank. The caller should batch these into the
 *   destination (grouped `INSERT`s) rather than collect them.
 * @param options - See {@link SortArchiveUrlsOptions}.
 * @example
 * await sortArchiveUrls(
 *   accessor,
 *   async (url, rank) => { await insertRankedRow(url, rank); },
 *   { onProgress: (message) => console.log(message) },
 * );
 */
export async function sortArchiveUrls(
	accessor: ArchiveAccessor,
	onRow: (url: string, rank: number) => Promise<void>,
	options: SortArchiveUrlsOptions = {},
): Promise<void> {
	const { readChunkSize = READ_CHUNK_SIZE, onProgress } = options;

	// A row-count estimate up front — cheap even on a multi-GB archive, since
	// `COUNT(*)` on SQLite is a single index-only scan — is what turns the
	// progress lines below into a percentage instead of a bare counter.
	const knex = accessor.getKnex();
	const [pagesCount, resourcesCount] = await Promise.all([
		knex('content_items').count<{ count: number }[]>({ count: '*' }),
		knex('resource_items').count<{ count: number }[]>({ count: '*' }),
	]);
	const totalRows =
		Number(pagesCount[0]?.count ?? 0) + Number(resourcesCount[0]?.count ?? 0);
	const percentOf = (done: number): number =>
		totalRows > 0 ? Math.min(100, Math.floor((done / totalRows) * 100)) : 100;

	const distinctUrls = new Set<string>();
	let rowsRead = 0;
	for (const table of ['pages', 'resources'] as const) {
		let tableRows = 0;
		for await (const urls of readUrlChunks(accessor, table, readChunkSize)) {
			for (const url of urls) {
				distinctUrls.add(url);
			}
			tableRows += urls.length;
			rowsRead += urls.length;
			onProgress?.(
				`Sorting URLs: reading ${table} — ${tableRows.toLocaleString()} rows ` +
					`(${percentOf(rowsRead)}% overall)`,
			);
		}
	}

	const urls = [...distinctUrls];
	distinctUrls.clear();
	onProgress?.(`Sorting URLs: ranking ${urls.length.toLocaleString()} distinct URLs…`);
	const ranks = computeUrlSortRanks(urls);

	// `ranks[i]` is where `urls[i]` goes; handing the rows out in rank order
	// needs the inverse.
	const urlIndexByRank = new Uint32Array(urls.length);
	for (const [index, rank] of ranks.entries()) {
		urlIndexByRank[rank] = index;
	}
	for (const [rank, urlIndex] of urlIndexByRank.entries()) {
		await onRow(urls[urlIndex]!, rank);
		if ((rank + 1) % EMIT_PROGRESS_INTERVAL === 0) {
			onProgress?.(
				`Sorting URLs: writing ranks — ${(rank + 1).toLocaleString()} of ${urls.length.toLocaleString()} distinct URLs`,
			);
		}
	}
	onProgress?.(
		`Sorting URLs: done — ${urls.length.toLocaleString()} distinct URLs ranked`,
	);
}
