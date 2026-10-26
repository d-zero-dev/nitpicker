import type {
	NativeSearchPattern,
	SnapshotSearchOutcome,
	StoredHtmlSnapshot,
} from './types.js';

import { nativeBinding } from './native-binding.js';
import { packStoredSnapshots } from './pack-stored-snapshots.js';
import { runWithSignal } from './run-with-signal.js';

/**
 * Searches a batch of stored HTML snapshots for a pattern.
 *
 * Each snapshot is decompressed, read as UTF-8 and searched as
 * {@link import('./search-html-document.js').searchHtmlDocument} does, in
 * parallel on the native thread pool, so no more decompressed documents are
 * alive at once than there are threads. The pattern is compiled once, not per
 * snapshot, and the addon reuses the last compiled pattern across batches. The
 * call waits its turn behind any other asynchronous native call when
 * `NITPICKER_NATIVE_CONCURRENCY` calls are already running (see
 * `checkNativeExecutorConfig`). Only the
 * batch's stored bytes cross the boundary, as one buffer and one offsets
 * array.
 *
 * A snapshot that cannot be decompressed fails the whole call; it is never
 * reported as "no match".
 * @param options - The pattern, the snippet size and the batch.
 * @param options.pattern - The pattern and its flags.
 * @param options.snippetLength - Window size in characters.
 * @param options.snapshots - The stored snapshots, in the order the results are returned.
 * @param options.signal - Stops the call at its next snapshot; a call still waiting for its turn stops when the turn comes.
 * @returns One outcome per snapshot, in input order; `matchCount` is 0 where nothing matched.
 * @throws {Error} If a codec is not `zstd` or `none`, or the batch takes more than 4 GiB.
 *   The returned promise rejects with code `InvalidArg` if the pattern cannot be
 *   compiled or the batch is malformed, and with a plain error naming the snapshot
 *   (`snapshot <n> could not be decoded`) if its zstd data is corrupt, and with
 *   the signal's reason if `signal` aborted before the call finished.
 * @example
 * ```ts
 * const outcomes = await searchHtmlSnapshots({
 * 	pattern: { source: 'gtag(', literal: true, ignoreCase: false, multiLine: false, dotAll: false },
 * 	snippetLength: 160,
 * 	snapshots: rows.map((row) => ({ body: row.body, codec: row.codec })),
 * });
 * const hits = outcomes.filter((outcome) => outcome.matchCount > 0);
 * ```
 */
export async function searchHtmlSnapshots(options: {
	readonly pattern: NativeSearchPattern;
	readonly snippetLength: number;
	readonly snapshots: readonly StoredHtmlSnapshot[];
	readonly signal?: AbortSignal;
}): Promise<SnapshotSearchOutcome[]> {
	const { pattern, snippetLength, snapshots, signal } = options;
	// Before packing: a request that is already cancelled copies nothing.
	signal?.throwIfAborted();
	const { bodies, offsets, codecs } = packStoredSnapshots(snapshots);
	const { matchCounts, snippets } = await runWithSignal(signal, (cancelToken) =>
		nativeBinding.searchHtmlSnapshots(
			pattern,
			snippetLength,
			bodies,
			offsets,
			codecs,
			cancelToken,
		),
	);
	return matchCounts.map((matchCount, index) => ({
		matchCount,
		snippet: snippets[index]!,
	}));
}
