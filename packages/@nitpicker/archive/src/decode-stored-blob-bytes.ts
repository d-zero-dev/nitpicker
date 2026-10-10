import { zstdDecompressSync } from 'node:zlib';

/**
 * Decodes a stored HTML body BLOB to its UTF-8 bytes according to its codec
 * marker, without building a JavaScript string.
 *
 * For consumers that hand the HTML straight to byte-oriented code (the
 * `@nitpicker/core` native addon): going through `decodeStoredBlob`'s string
 * would decode to UTF-16 and immediately re-encode to the same bytes, two
 * full-size copies per page. Stored blobs are always `Buffer.from(html)`
 * output, so the bytes are valid UTF-8 and identical to that round-trip.
 * @param body - Raw bytes as stored in `page_html_blobs.body`.
 * @param codec - The `codec` column value (e.g. `'zstd'`, `'none'`).
 * @returns The HTML as UTF-8 bytes.
 * @throws {Error} If the codec is not recognised.
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
		return zstdDecompressSync(buffer);
	}
	if (codec === 'none') {
		return buffer;
	}
	throw new Error(`Unknown page_html_blobs.codec: ${codec}`);
}
