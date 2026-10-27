import { nativeBinding } from './native-binding.js';

/**
 * The addon's limit, checked to be a positive integer.
 * @returns The limit in bytes.
 * @throws {TypeError} If the addon does not export it.
 */
function readLimit(): number {
	const limit: unknown = nativeBinding.MAX_DECODED_SNAPSHOT_BYTES;
	if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) {
		throw new TypeError(
			`The native addon exports no valid MAX_DECODED_SNAPSHOT_BYTES (got ${String(limit)}); rebuild or reinstall @nitpicker/core.`,
		);
	}
	return limit;
}

/**
 * Bytes one zstd-compressed HTML snapshot may decompress to (3 × (2^29 − 24),
 * about 1.5 GiB). A snapshot that decompresses past it is reported as
 * undecodable instead of being held whole: the size a zstd frame header
 * states can be absent or false, so a stored blob of a few kilobytes can
 * otherwise expand to any size, on every thread of a batch at once (RFC 8878,
 * §8). A snapshot stored uncompressed is not limited — it is already in
 * memory at its size.
 *
 * The value is the most the crawler can store, so no snapshot it stored is
 * ever refused: a snapshot is the string `page.content()` returns, saved as
 * UTF-8, a V8 string holds at most 2^29 − 24 UTF-16 code units, and one code
 * unit takes at most 3 bytes of UTF-8. Read from the addon, which owns the value; the
 * batch wrappers pass this module's export back to it, so a spec can shrink
 * it. An addon that lacks it fails the import rather than leaving
 * `maxOutputLength` undefined, which would decompress without a limit.
 * @example
 * ```ts
 * zstdDecompressSync(body, { maxOutputLength: MAX_DECODED_SNAPSHOT_BYTES });
 * ```
 */
export const MAX_DECODED_SNAPSHOT_BYTES: number = readLimit();
