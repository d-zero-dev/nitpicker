import { decodeStoredBlobBytes } from './decode-stored-blob-bytes.js';

/**
 * Decodes a page's stored HTML snapshot to its UTF-8 bytes, as
 * {@link decodeStoredBlobBytes} does, naming the page and the blob when it
 * cannot be decoded (corrupt zstd data, a zstd blob that decompresses past
 * `MAX_DECODED_SNAPSHOT_BYTES`, or an unknown codec). The decoder sees only
 * the bytes, so without the page and hash its error points at no row.
 * @param row - The page and the `page_html_blobs` row it references.
 * @param row.pageId - The page's id.
 * @param row.hash - `page_html_blobs.hash`.
 * @param row.body - `page_html_blobs.body`.
 * @param row.codec - `page_html_blobs.codec`.
 * @returns The HTML as UTF-8 bytes.
 * @throws {Error} `HTML snapshot of page <id> (page_html_blobs hash <hex>) could not be decoded: <reason>`,
 *   with the decoder's error as its `cause`.
 * @example
 * ```ts
 * const html = decodePageHtmlBlobBytes({ pageId, hash, body, codec }).toString('utf8');
 * ```
 */
export function decodePageHtmlBlobBytes(row: {
	readonly pageId: number;
	readonly hash: Uint8Array;
	readonly body: Uint8Array;
	readonly codec: string;
}): Buffer {
	try {
		return decodeStoredBlobBytes(row.body, row.codec);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`HTML snapshot of page ${row.pageId} (page_html_blobs hash ${Buffer.from(row.hash).toString('hex')}) could not be decoded: ${reason}`,
			{ cause: error },
		);
	}
}
