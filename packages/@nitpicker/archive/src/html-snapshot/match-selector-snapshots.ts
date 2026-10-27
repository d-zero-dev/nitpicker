import type { SelectorPlan, SnapshotMatchOutcome, StoredHtmlSnapshot } from './types.js';

import { matchSelectorSnapshots as matchSelectorSnapshotsNatively } from '@nitpicker/core/match-selector-snapshots';

/**
 * Judges a batch of stored HTML snapshots (rows of `page_html_blobs`)
 * against a planned selector list: each is decompressed, read as UTF-8 and
 * judged as {@link import('./match-selector-html.js').matchSelectorHtml}
 * does, in parallel on the native thread pool, one decoded document per
 * thread at a time.
 *
 * A snapshot that cannot be decompressed, or has a codec other than `zstd`
 * or `none`, fails the whole call; it is never judged "no match".
 * @param options - The plan and the batch.
 * @param options.plan - The validated selector list.
 * @param options.snapshots - The stored snapshots, in the order the verdicts are returned.
 * @param options.signal - Stops the call at its next snapshot, or within the next mebibyte of a decompression under way; a call still waiting for its turn stops when the turn comes.
 * @returns One verdict per snapshot, in input order.
 * @throws {Error} If a codec is not `zstd` or `none`, or the batch takes more than 4 GiB.
 *   The returned promise rejects (`snapshot <n> could not be decoded`) if a snapshot's
 *   zstd data is corrupt or decompresses past `MAX_DECODED_SNAPSHOT_BYTES`, or with code
 *   `InvalidArg` if the plan is malformed, and with the signal's reason if `signal` aborted
 *   before the call finished.
 * @example
 * ```ts
 * const verdicts = await matchSelectorSnapshots({
 * 	plan,
 * 	snapshots: rows.map((row) => ({ body: row.body, codec: row.codec })),
 * });
 * ```
 */
export function matchSelectorSnapshots(options: {
	readonly plan: SelectorPlan;
	readonly snapshots: readonly StoredHtmlSnapshot[];
	readonly signal?: AbortSignal;
}): Promise<SnapshotMatchOutcome[]> {
	// Passing archive's types to core's wrapper, and taking its result as
	// archive's type, is the check that the two still mirror each other.
	return matchSelectorSnapshotsNatively(options);
}
