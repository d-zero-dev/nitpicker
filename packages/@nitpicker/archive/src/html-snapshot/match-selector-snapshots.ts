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
 * @returns One verdict per snapshot, in input order.
 * @throws {Error} If a codec is not `zstd` or `none`, or the batch takes more than 4 GiB.
 *   The returned promise rejects if a snapshot's zstd data is corrupt, or with code
 *   `InvalidArg` if the plan is malformed.
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
}): Promise<SnapshotMatchOutcome[]> {
	// Passing archive's types to core's wrapper, and taking its result as
	// archive's type, is the check that the two still mirror each other.
	return matchSelectorSnapshotsNatively(options);
}
