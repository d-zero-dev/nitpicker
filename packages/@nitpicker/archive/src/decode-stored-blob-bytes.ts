import { zstdDecompressSync } from 'node:zlib';

import { MAX_DECODED_SNAPSHOT_BYTES } from '@nitpicker/core/max-decoded-snapshot-bytes';

/**
 * Decodes a stored HTML body BLOB to its UTF-8 bytes according to its codec
 * marker, without building a JavaScript string.
 *
 * For consumers that hand the HTML straight to byte-oriented code (the
 * `@nitpicker/core` native addon): going through `decodeStoredBlob`'s string
 * would decode to UTF-16 and immediately re-encode to the same bytes, two
 * full-size copies per page. Stored blobs are always `Buffer.from(html)`
 * output, so the bytes are valid UTF-8 and identical to that round-trip.
 *
 * A zstd blob may decompress to at most `MAX_DECODED_SNAPSHOT_BYTES`, the
 * same limit the native HTML scans apply, so a document that one path can
 * decompress is one every path can. The error names no row; a reader that
 * knows the page uses `decodePageHtmlBlobBytes`.
 * @param body - Raw bytes as stored in `page_html_blobs.body`.
 * @param codec - The `codec` column value (e.g. `'zstd'`, `'none'`).
 * @returns The HTML as UTF-8 bytes.
 * @throws {Error} If the codec is not recognised, or a zstd blob decompresses past the limit.
 * @example
 * ```ts
 * const bytes = decodeStoredBlobBytes(row.body, row.codec);
 * computeBodyHash(bytes);
 * ```
 */
export function decodeStoredBlobBytes(body: Uint8Array, codec: string): Buffer {
	// `Buffer.from(buffer)` accepts Uint8Array, Buffer, and array-like
	// shapes uniformly; libsql may hand back any of these for a BLOB
	// column depending on the row encoding.
	const buffer = Buffer.from(body);
	if (codec === 'zstd') {
		try {
			return zstdDecompressSync(buffer, { maxOutputLength: MAX_DECODED_SNAPSHOT_BYTES });
		} catch (error) {
			if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') {
				throw new Error(
					`The page_html_blobs blob decompresses to more than ${MAX_DECODED_SNAPSHOT_BYTES} bytes, the limit on one snapshot`,
					{ cause: error },
				);
			}
			throw error;
		}
	}
	if (codec === 'none') {
		return buffer;
	}
	throw new Error(`Unknown page_html_blobs.codec: ${codec}`);
}
