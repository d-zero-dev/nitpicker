import type { SelectorPlan, SnapshotMatchOutcome, StoredHtmlSnapshot } from './types.js';

import { nativeBinding } from './native-binding.js';
import { packStoredSnapshots } from './pack-stored-snapshots.js';
import { runWithSignal } from './run-with-signal.js';
import { toNativeSelectorPlan } from './to-native-selector-plan.js';

/** Bit 0 of a verdict byte the native call returns: an element matched. */
const MATCHED = 1;
/** Bit 1: the ordered-literal prefilter rejected the document alone. */
const PREFILTERED = 2;
/** Bit 2: the open-element stack judged the document. */
const TOKENIZED = 4;

/**
 * Judges a batch of stored HTML snapshots against a planned selector list.
 *
 * Each snapshot is decompressed, read as UTF-8 (an invalid sequence becomes
 * U+FFFD, as `Buffer#toString('utf8')` reads it) and judged by
 * {@link import('./match-selector-html.js').matchSelectorHtml}'s rules, in
 * parallel on the native thread pool. No more decompressed documents are
 * alive at once than there are threads. The call waits its turn behind any
 * other asynchronous native call when `NITPICKER_NATIVE_CONCURRENCY` calls are
 * already running (see `checkNativeExecutorConfig`). Only the batch's stored bytes cross
 * the boundary, as one buffer and one offsets array.
 *
 * A snapshot that cannot be decompressed fails the whole call; it is never
 * judged "no match".
 * @param options - The plan and the batch.
 * @param options.plan - The validated selector list.
 * @param options.snapshots - The stored snapshots, in the order the verdicts are returned.
 * @param options.signal - Stops the call at its next snapshot; a call still waiting for its turn stops when the turn comes.
 * @returns One verdict per snapshot, in input order.
 * @throws {Error} If a codec is not `zstd` or `none`, or the batch takes more than 4 GiB.
 *   The returned promise rejects if a snapshot's zstd data is corrupt, and with
 *   the signal's reason if `signal` aborted before the call finished.
 * @example
 * ```ts
 * const verdicts = await matchSelectorSnapshots({
 * 	plan,
 * 	snapshots: rows.map((row) => ({ body: row.body, codec: row.codec })),
 * });
 * const matchedCount = verdicts.filter((verdict) => verdict.matched).length;
 * ```
 */
export async function matchSelectorSnapshots(options: {
	readonly plan: SelectorPlan;
	readonly snapshots: readonly StoredHtmlSnapshot[];
	readonly signal?: AbortSignal;
}): Promise<SnapshotMatchOutcome[]> {
	const { plan, snapshots, signal } = options;
	// Before packing: a request that is already cancelled copies nothing.
	signal?.throwIfAborted();
	const { bodies, offsets, codecs } = packStoredSnapshots(snapshots);
	const flags = await runWithSignal(signal, (cancelToken) =>
		nativeBinding.matchSelectorSnapshots(
			toNativeSelectorPlan(plan),
			bodies,
			offsets,
			codecs,
			cancelToken,
		),
	);
	return [...flags].map((flag) => ({
		matched: (flag & MATCHED) !== 0,
		prefiltered: (flag & PREFILTERED) !== 0,
		tokenized: (flag & TOKENIZED) !== 0,
	}));
}
