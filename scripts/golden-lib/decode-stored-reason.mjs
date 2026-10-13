import { zstdDecompressSync } from 'node:zlib';

/**
 * Decodes a `page_template_clusters.reason_json` BLOB back to the JSON text
 * that was stored.
 * @param {Uint8Array} body - The BLOB.
 * @param {string} codec - The row's `codec` (`zstd` or `none`).
 * @returns {string} The JSON text.
 * @throws {Error} For any other codec.
 * @example
 * const json = decodeStoredReason(row.body, row.codec);
 */
export function decodeStoredReason(body, codec) {
	const buffer = Buffer.from(body);
	if (codec === 'zstd') {
		return zstdDecompressSync(buffer).toString('utf8');
	}
	if (codec === 'none') {
		return buffer.toString('utf8');
	}
	throw new Error(`Unknown page_template_clusters.codec: ${codec}`);
}
