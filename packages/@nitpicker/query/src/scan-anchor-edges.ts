import type { AnchorEdgeRow, ScanAnchorEdgesOptions } from './types.js';

import { releaseFinishedStatements } from '@nitpicker/archive/release-finished-statements';

/** Rows read per chunk when the caller gives no `chunkSize`. */
const DEFAULT_CHUNK_SIZE = 100_000;

/**
 * Reads every row of `anchor_edges` once, in `(page_id, href_page_id)` order,
 * a chunk at a time.
 *
 * The scan walks the `UNIQUE(page_id, href_page_id)` auto-index, which holds
 * both columns, so no table row is touched; each chunk resumes after the last
 * pair of the previous one (`(page_id, href_page_id) > (?, ?)`, a row-value
 * comparison, which SQLite has had since 3.15), so the cost of a chunk does not
 * grow with its position. That is what makes it linear in the number of edges
 * where a join of `anchor_edges` with `content_items` twice over (to filter
 * both ends) does not finish on archives with millions of edges: the caller
 * keeps the edges it wants by looking each end up in a set it already holds.
 * Memory is one chunk of rows.
 *
 * Reads only, and one statement per chunk, so a page written while the scan
 * runs may or may not be seen. Chunks are delivered in order, one after
 * another: the next is not read before `onChunk` (which may be asynchronous)
 * has finished with the previous one. The rows are not kept, so `onChunk`
 * takes what it needs from them there.
 * @param options - The knex instance, the chunk callback and the chunk size.
 * @returns Resolves once every edge was handed to `onChunk`.
 * @throws {RangeError} When `chunkSize` is not a positive integer (a limit of
 *   zero would read nothing and look like an archive without edges).
 * @throws {TypeError} When the driver does not return the rows as an array.
 * @example
 * let edges = 0;
 * await scanAnchorEdges({
 * 	knex: accessor.getKnex(),
 * 	onChunk: (rows) => {
 * 		edges += rows.length;
 * 	},
 * });
 */
export async function scanAnchorEdges(options: ScanAnchorEdgesOptions): Promise<void> {
	const { knex, onChunk, chunkSize = DEFAULT_CHUNK_SIZE } = options;
	if (!Number.isInteger(chunkSize) || chunkSize < 1) {
		throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
	}
	// Below every id, so an edge of page 0 (ids start at 1, but nothing forbids
	// it) is not skipped by the strict comparison.
	let lastPage = -1;
	let lastHref = -1;
	for (;;) {
		const rows: unknown = await knex('anchor_edges')
			.select('page_id as pageId', 'href_page_id as hrefId')
			.whereRaw('(page_id, href_page_id) > (?, ?)', [lastPage, lastHref])
			.orderBy('page_id')
			.orderBy('href_page_id')
			.limit(chunkSize);
		// Before either exit below, so every SELECT of the scan is released
		// as it goes rather than when the whole call returns (see the helper).
		await releaseFinishedStatements();
		if (!Array.isArray(rows)) {
			throw new TypeError(
				'The database driver did not return the anchor edges as an array',
			);
		}
		const last = (rows as AnchorEdgeRow[]).at(-1);
		if (last === undefined) {
			return;
		}
		await onChunk(rows as AnchorEdgeRow[]);
		if (rows.length < chunkSize) {
			// A short chunk is the last one: the next query would come back empty.
			return;
		}
		lastPage = last.pageId;
		lastHref = last.hrefId;
	}
}
