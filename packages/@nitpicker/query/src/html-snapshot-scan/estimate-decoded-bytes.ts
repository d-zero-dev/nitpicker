/** zstd frame magic number as a little-endian `u32` (the bytes 28 B5 2F FD). */
const ZSTD_MAGIC = 4_247_762_216;

/** Bytes of the `Dictionary_ID` field by its 2-bit flag. */
const DICTIONARY_ID_BYTES = [0, 1, 2, 4] as const;

/**
 * Assumed decoded-to-stored ratio of a zstd snapshot whose header does not
 * state its size. HTML compresses to roughly a tenth of its size or better.
 */
const FALLBACK_RATIO = 8;

/**
 * The decoded size a zstd frame states in its header (`Frame_Content_Size`),
 * or `null` when the frame is not zstd or does not state one.
 * @param body - The stored bytes.
 * @returns The decoded size in bytes, or `null`.
 */
function readZstdContentSize(body: Uint8Array): number | null {
	if (body.byteLength < 6) {
		return null;
	}
	const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
	if (view.getUint32(0, true) !== ZSTD_MAGIC) {
		return null;
	}
	const descriptor = body[4]!;
	const contentSizeFlag = descriptor >> 6;
	const singleSegment = (descriptor & 0b0010_0000) !== 0;
	const dictionaryBytes = DICTIONARY_ID_BYTES[descriptor & 0b11]!;
	const contentSizeBytes =
		contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 2 ** contentSizeFlag;
	if (contentSizeBytes === 0) {
		return null;
	}
	const offset = 5 + (singleSegment ? 0 : 1) + dictionaryBytes;
	if (offset + contentSizeBytes > body.byteLength) {
		return null;
	}
	switch (contentSizeBytes) {
		case 1: {
			return view.getUint8(offset);
		}
		case 2: {
			return view.getUint16(offset, true) + 256;
		}
		case 4: {
			return view.getUint32(offset, true);
		}
		default: {
			return Number(view.getBigUint64(offset, true));
		}
	}
}

/**
 * Estimates how many bytes a stored snapshot takes once decoded, without
 * decoding it: a zstd frame states its decoded size in its header; any
 * other case is assumed to compress {@link FALLBACK_RATIO} to one. Never
 * less than the stored size.
 *
 * An estimate, used only to close a batch of snapshots before the judge
 * holds too many; the judge decodes for real. It reads the first frame's
 * header only: a blob of concatenated frames is estimated by its first frame
 * (walking the frames would mean parsing their blocks, for a figure that
 * only paces batches).
 * @param snapshot - The stored snapshot.
 * @param snapshot.body - The stored bytes.
 * @param snapshot.codec - `page_html_blobs.codec`.
 * @returns The estimated decoded size in bytes.
 * @example
 * estimateDecodedBytes({ body: Buffer.from('<p>x</p>'), codec: 'none' }); // 8
 */
export function estimateDecodedBytes(snapshot: {
	readonly body: Uint8Array;
	readonly codec: string;
}): number {
	const stored = snapshot.body.byteLength;
	if (snapshot.codec !== 'zstd') {
		return stored;
	}
	return Math.max(stored, readZstdContentSize(snapshot.body) ?? stored * FALLBACK_RATIO);
}
