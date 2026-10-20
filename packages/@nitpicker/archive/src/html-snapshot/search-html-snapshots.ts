import type {
	SearchPattern,
	SnapshotSearchOutcome,
	StoredHtmlSnapshot,
} from './types.js';

import { searchHtmlSnapshots as searchHtmlSnapshotsNatively } from '@nitpicker/core/search-html-snapshots';

/**
 * Searches a batch of stored HTML snapshots (rows of `page_html_blobs`) for
 * a pattern: each is decompressed, read as UTF-8 and searched as
 * {@link import('./search-html-document.js').searchHtmlDocument} does, in
 * parallel on the native thread pool, one decoded document per thread at a
 * time.
 *
 * A snapshot that cannot be decompressed, or has a codec other than `zstd`
 * or `none`, fails the whole call; it is never reported as "no match".
 * @param options - The pattern, the snippet size and the batch.
 * @param options.pattern - The pattern and its flags.
 * @param options.snippetLength - Window size in characters.
 * @param options.snapshots - The stored snapshots, in the order the outcomes are returned.
 * @returns One outcome per snapshot, in input order; `matchCount` is 0 where nothing matched.
 * @throws {Error} If a codec is not `zstd` or `none`, or the batch takes more than 4 GiB.
 *   The returned promise rejects if a snapshot's zstd data is corrupt, or with code
 *   `InvalidArg` if the pattern cannot be compiled.
 * @example
 * ```ts
 * const outcomes = await searchHtmlSnapshots({
 * 	pattern: { source: 'gtag(', literal: true, ignoreCase: false, multiLine: false, dotAll: false },
 * 	snippetLength: 160,
 * 	snapshots: rows.map((row) => ({ body: row.body, codec: row.codec })),
 * });
 * ```
 */
export function searchHtmlSnapshots(options: {
	readonly pattern: SearchPattern;
	readonly snippetLength: number;
	readonly snapshots: readonly StoredHtmlSnapshot[];
}): Promise<SnapshotSearchOutcome[]> {
	// Passing archive's types to core's wrapper, and taking its result as
	// archive's type, is the check that the two still mirror each other.
	return searchHtmlSnapshotsNatively(options);
}
