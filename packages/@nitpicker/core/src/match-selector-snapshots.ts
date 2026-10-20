import type { SelectorPlan, SnapshotMatchOutcome, StoredHtmlSnapshot } from './types.js';

import { nativeBinding } from './native-binding.js';
import { toNativeSelectorPlan } from './to-native-selector-plan.js';

/** The native call addresses the batch with `u32` offsets. */
const MAX_BATCH_BYTES = 4_294_967_295;

/** The codec byte the native call reads for a snapshot stored as it is. */
const CODEC_NONE = 0;
/** The codec byte the native call reads for a zstd snapshot. */
const CODEC_ZSTD = 1;

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
 * alive at once than there are threads. Only the batch's stored bytes cross
 * the boundary, as one buffer and one offsets array.
 *
 * A snapshot that cannot be decompressed fails the whole call; it is never
 * judged "no match".
 * @param options - The plan and the batch.
 * @param options.plan - The validated selector list.
 * @param options.snapshots - The stored snapshots, in the order the verdicts are returned.
 * @returns One verdict per snapshot, in input order.
 * @throws {Error} If a codec is not `zstd` or `none`, or the batch takes more than 4 GiB.
 *   The returned promise rejects if a snapshot's zstd data is corrupt.
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
}): Promise<SnapshotMatchOutcome[]> {
	const { plan, snapshots } = options;
	const offsets = new Uint32Array(snapshots.length + 1);
	const codecs = new Uint8Array(snapshots.length);
	let total = 0;
	for (const [index, snapshot] of snapshots.entries()) {
		switch (snapshot.codec) {
			case 'none': {
				codecs[index] = CODEC_NONE;
				break;
			}
			case 'zstd': {
				codecs[index] = CODEC_ZSTD;
				break;
			}
			default: {
				throw new Error(`Unknown page_html_blobs.codec: ${snapshot.codec}`);
			}
		}
		total += snapshot.body.byteLength;
		if (total > MAX_BATCH_BYTES) {
			throw new RangeError(
				`The batch takes more than ${MAX_BATCH_BYTES} bytes (4 GiB), which the native call cannot address.`,
			);
		}
		offsets[index + 1] = total;
	}
	const bodies = new Uint8Array(total);
	for (const [index, snapshot] of snapshots.entries()) {
		bodies.set(snapshot.body, offsets[index]);
	}
	const flags = await nativeBinding.matchSelectorSnapshots(
		toNativeSelectorPlan(plan),
		bodies,
		offsets,
		codecs,
	);
	return [...flags].map((flag) => ({
		matched: (flag & MATCHED) !== 0,
		prefiltered: (flag & PREFILTERED) !== 0,
		tokenized: (flag & TOKENIZED) !== 0,
	}));
}
