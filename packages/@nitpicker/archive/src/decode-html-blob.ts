import { decodeStoredBlobBytes } from './decode-stored-blob-bytes.js';

/**
 * Decodes a stored HTML body BLOB according to its codec marker. The codec
 * column on `page_html_blobs` records which encoding was applied at write
 * time so individual rows can be migrated to a different compression without
 * a table-wide rewrite.
 *
 * Decodes the bytes alone, so an error names no row; a reader that knows the
 * page (`getHtmlOfPageById`, the 0.13 migration's `populate-image-items.ts`)
 * decodes through `decodePageHtmlBlobBytes` instead, which names the page and
 * the blob hash.
 * @param body - Raw bytes as stored in `page_html_blobs.body`.
 * @param codec - The `codec` column value (e.g. `'zstd'`, `'none'`).
 * @returns The decoded HTML string.
 * @throws {Error} If the codec is not recognised, or a zstd blob decompresses past `MAX_DECODED_SNAPSHOT_BYTES`.
 * @example
 * ```ts
 * const html = decodeStoredBlob(row.body, row.codec);
 * ```
 */
export function decodeStoredBlob(body: Uint8Array, codec: string): string {
	return decodeStoredBlobBytes(body, codec).toString('utf8');
}
