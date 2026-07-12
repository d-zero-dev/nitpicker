import { createHash } from 'node:crypto';

/**
 * Computes a 32-byte content hash for a UTF-8 string or raw byte buffer.
 *
 * The Phase 6 plan (`docs/write-model-refactor-plan.md`) refers to the hash
 * columns on `text_refs`, `json_refs`, `blob_refs`, `header_value_refs`, and
 * `header_sets` as "BLAKE3" hashes. This implementation uses **SHA-256** for
 * three reasons:
 *
 * 1. **No new dependency**. `@nitpicker/crawler`'s dependency list is small
 *    and CLAUDE.md's supply-chain rules discourage adding a hash-only lib.
 * 2. **Consistency**. `page_html_blobs.hash` — the existing content-addressable
 *    dictionary — is SHA-256 (see `Database.#writePageHtmlBlob`). Using the
 *    same algorithm keeps every content-hash column in the archive on one
 *    scheme.
 * 3. **Column contract is length-only**. Every Phase 6-A hash column is typed
 *    `BLOB` (32 bytes when populated). SHA-256 satisfies that contract.
 *
 * If BLAKE3 is later required for throughput, this single function is the only
 * edit point — every callsite in Phase 6-B routes through here.
 * @param value - Value to hash. `string` inputs are encoded as UTF-8.
 * @returns 32-byte hash as a `Buffer`, ready to insert into a `BLOB` column.
 */
export function computeContentHash(value: string | Uint8Array): Buffer {
	const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
	return createHash('sha256').update(bytes).digest();
}
