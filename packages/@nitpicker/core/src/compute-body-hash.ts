import { nativeBinding } from './native-binding.js';

/**
 * Computes the content hash stored as `page_meta.body_hash`: SHA-256 of the
 * page's `<body>` content after collapsing `/index.{ext}` URL forms to `/`
 * and masking mixed letter-and-digit tokens of 8+ characters (cache-busting
 * hashes, session ids, CSS-module suffixes).
 *
 * Takes UTF-8 bytes rather than a string so the native side never builds a
 * UTF-16 copy. The result is byte-identical to the hashes already stored in
 * existing archives, which JavaScript computed (golden fixture in
 * `crates/nitpicker_html_scan/tests/fixtures/`), so old and new crawls stay
 * comparable.
 * @param html - The full HTML document (or a fragment) as UTF-8 bytes —
 *   `Buffer.from(html, 'utf8')`.
 * @returns The 32-byte hash, ready to insert into a `BLOB` column.
 * @example
 * ```ts
 * const a = computeBodyHash(Buffer.from('<body><a href="/p/a1b2c3d4">x</a></body>'));
 * const b = computeBodyHash(Buffer.from('<body><a href="/p/z9y8x7w6">x</a></body>'));
 * a.equals(b); // true — the differing token is masked before hashing
 * ```
 */
export function computeBodyHash(html: Uint8Array): Buffer {
	return nativeBinding.computeBodyHash(html);
}
