import { zstdCompressSync } from 'node:zlib';

/**
 * Compresses raw bytes for storage in a `codec`/`size_raw`/`size_stored`
 * BLOB column, matching the read side of
 * {@link import('./decode-json-ref.js').decodeJsonRef} and
 * {@link import('../../decode-html-blob.js').decodeStoredBlob}.
 *
 * The one shared primitive behind every `codec: 'zstd'` writer in the
 * archive (`upsert-json-ref.ts`, `write-page-html-blob.ts`,
 * `replace-page-templates.ts`) — a codec change (e.g. a brotli fallback, a
 * different zstd level) only has to happen here. Callers that also need a
 * content hash (`upsert-json-ref.ts`, `write-page-html-blob.ts`) compute it
 * themselves from the same `rawBytes` they pass in here, rather than this
 * function computing one not every caller needs.
 * @param rawBytes - The raw (uncompressed) payload bytes.
 * @returns The compressed body alongside the codec and size bookkeeping the
 *   BLOB column's schema expects.
 * @example
 * const rawBytes = Buffer.from(JSON.stringify(reason), 'utf8');
 * const { body, codec, sizeRaw, sizeStored } = compressPayload(rawBytes);
 */
export function compressPayload(rawBytes: Buffer): {
	readonly body: Buffer;
	readonly codec: 'zstd';
	readonly sizeRaw: number;
	readonly sizeStored: number;
} {
	const compressed = zstdCompressSync(rawBytes);
	return {
		body: compressed,
		codec: 'zstd',
		sizeRaw: rawBytes.byteLength,
		sizeStored: compressed.byteLength,
	};
}
