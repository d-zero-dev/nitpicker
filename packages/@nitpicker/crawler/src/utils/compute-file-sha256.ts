import { createHash } from 'node:crypto';

/**
 * Compute the SHA-256 digest of an in-memory byte buffer.
 *
 * Used by `CrawlerOrchestrator.inventory` to fingerprint the source URL
 * list — the digest is both recorded on the `list_reconcile_runs` audit row
 * (the content-identity key for "was this exact list applied before") and
 * used as the file name under which the raw list is archived
 * (`Archive.saveInventorySourceList`).
 *
 * Takes an already-read `Buffer` rather than a file path: the CLI reads the
 * source file exactly once (`inventoryCrawl`) and derives the digest, the
 * parsed URL list, and the archived copy all from that single buffer. A
 * separate read-then-hash pass would let the file change between the two
 * reads and desync the archived bytes from the hash naming them.
 * @param bytes - The exact bytes to hash.
 * @returns Lower-case hex digest (64 chars).
 * @example
 * ```ts
 * const bytes = await fs.readFile('/tmp/list.txt');
 * const sha = computeFileSha256(bytes);
 * console.log(sha); // 64-char hex string
 * ```
 */
export function computeFileSha256(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}
