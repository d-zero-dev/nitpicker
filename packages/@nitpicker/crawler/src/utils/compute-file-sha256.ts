import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

import { crawlerLog } from '../debug.js';

/**
 * Compute the SHA-256 digest of a file's bytes, streaming so memory stays
 * O(1) regardless of file size.
 *
 * Used by `CrawlerOrchestrator.inventory` to fingerprint the source
 * URL list `.txt` and store the digest on the `inventory_runs` row.
 * Phase 3 (`--refresh`) will key dedupe on this column; Phase 1 just
 * records it for operator audit.
 *
 * Returns `null` instead of throwing when the file cannot be read (e.g.
 * vanished mid-run, permissions issue) so the inventory run's audit row
 * can still be written with a NULL digest. Hashing failure is an audit
 * loss, not a correctness failure — the actual ingestion has already
 * succeeded by the time this is called.
 * @param filePath - Absolute or relative path to the file to hash.
 * @returns Lower-case hex digest (64 chars), or `null` if reading failed.
 * @example
 * ```ts
 * const sha = await computeFileSha256('/tmp/list.txt');
 * if (sha) console.log(sha); // 64-char hex string
 * ```
 */
export async function computeFileSha256(filePath: string): Promise<string | null> {
	return await new Promise((resolve) => {
		const hash = createHash('sha256');
		const stream = createReadStream(filePath);
		let settled = false;
		const settle = (value: string | null) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(value);
		};
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => settle(hash.digest('hex')));
		stream.on('error', (error) => {
			// Trace the failure so operators inspecting `--inventory`
			// audit rows with `source_file_sha256 = NULL` can recover
			// the underlying cause via `DEBUG=Nitpicker:Crawler:*`.
			crawlerLog('compute-file-sha256 failed for %s: %s', filePath, error.message);
			settle(null);
		});
		// `'close'` is the last-resort settler. If the stream is
		// destroyed externally between `'data'` and `'end'` (e.g. a
		// test or signal handler), neither `'end'` nor `'error'` may
		// fire — leaving the promise pending forever. Falling back to
		// `null` matches the documented contract ("hashing failure
		// yields null").
		stream.on('close', () => settle(null));
	});
}
