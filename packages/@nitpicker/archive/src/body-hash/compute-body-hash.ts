import { computeBodyHash as computeBodyHashNative } from '@nitpicker/core/compute-body-hash';

/**
 * Computes a content hash of a page's `<body>`, after normalizing away the
 * kinds of incidental variance that would otherwise make two structurally
 * identical pages hash differently: `/index.{ext}` URL-suffix forms and
 * embedded dynamic tokens (cache-busting hashes, session/order ids, per-build
 * CSS-module suffixes).
 *
 * Only the resulting hash is persisted (`page_meta.body_hash`) — the masked
 * intermediate string is never stored. The unmasked original HTML remains
 * fully recoverable from `page_html_blobs`, so nothing is lost by discarding
 * it here.
 *
 * The computation runs in the native addon (`@nitpicker/core`). The
 * JavaScript stages next to this file (`extract-body.ts`,
 * `normalize-url-like-strings.ts`, `mask-dynamic-ids.ts`) are not called
 * from here and are excluded from the build: they exist only as the oracle
 * for `compute-body-hash.parity.spec.ts`, which pins the addon to their
 * output and so to the values existing archives already hold.
 * @param html - A full HTML document (or fragment): a string, or its UTF-8
 *   bytes — pass bytes when they are already at hand (a stored blob via
 *   `decodeStoredBlobBytes`) to skip a decode/re-encode round-trip. Strings
 *   are encoded as `Buffer.from(html, 'utf8')` does, lone surrogates as U+FFFD.
 * @returns 32-byte SHA-256 hash of the masked `<body>` content, ready to
 *   insert into a `BLOB` column.
 * @example
 * ```ts
 * const hashA = computeBodyHash('<body><a href="/p/a1b2c3d4">x</a></body>');
 * const hashB = computeBodyHash('<body><a href="/p/z9y8x7w6">x</a></body>');
 * hashA.equals(hashB); // true — the differing token is masked before hashing
 * ```
 */
export function computeBodyHash(html: string | Uint8Array): Buffer {
	return computeBodyHashNative(
		typeof html === 'string' ? Buffer.from(html, 'utf8') : html,
	);
}
