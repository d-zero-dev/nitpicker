import type { StoredHtmlSnapshot } from './types.js';

/** The native calls address a batch with `u32` offsets. */
const MAX_BATCH_BYTES = 4_294_967_295;

/** The codec byte the native calls read for a snapshot stored as it is. */
const CODEC_NONE = 0;
/** The codec byte the native calls read for a zstd snapshot. */
const CODEC_ZSTD = 1;

/**
 * Lays a batch of stored snapshots out the way the native batch calls take
 * it: the stored bytes back to back, the `n + 1` offsets that cut them into
 * `n` snapshots, and one codec byte per snapshot. A batch crosses the
 * boundary as three buffers, whatever its size.
 * @param snapshots - The stored snapshots, in the order the results come back.
 * @returns The three buffers.
 * @throws {Error} If a codec is not `zstd` or `none`.
 * @throws {RangeError} If the batch takes more than 4 GiB.
 * @example
 * ```ts
 * const { bodies, offsets, codecs } = packStoredSnapshots([
 * 	{ body: Buffer.from('<p>a</p>'), codec: 'none' },
 * ]);
 * offsets; // Uint32Array [0, 8]
 * ```
 */
export function packStoredSnapshots(snapshots: readonly StoredHtmlSnapshot[]): {
	readonly bodies: Uint8Array;
	readonly offsets: Uint32Array;
	readonly codecs: Uint8Array;
} {
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
	return { bodies, offsets, codecs };
}
