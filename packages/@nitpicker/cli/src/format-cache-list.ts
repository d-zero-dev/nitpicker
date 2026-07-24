import type { ArchiveCacheEntry } from '@nitpicker/crawler';

import { formatBytes } from './format-bytes.js';

/**
 * Format a list of archive cache entries as human-readable text for
 * `nitpicker cache list` (the non-`--json` default).
 * @param entries - Entries returned by `listArchiveCacheEntries`.
 * @param cacheRoot - The cache root the entries were listed from, echoed in
 *   the header line so the output is self-describing.
 * @returns A multi-line report, or a one-line "nothing found" message when
 *   `entries` is empty.
 * @example
 * ```ts
 * console.log(formatCacheList(entries, cacheRoot));
 * ```
 */
export function formatCacheList(entries: ArchiveCacheEntry[], cacheRoot: string): string {
	if (entries.length === 0) {
		return `No cache entries found under ${cacheRoot}`;
	}

	const lines = [`Cache root: ${cacheRoot}`, ''];
	let totalBytes = 0;
	for (const entry of entries) {
		totalBytes += entry.sizeBytes;
		lines.push(
			`${entry.kind.padEnd(9)} ${formatBytes(entry.sizeBytes).padStart(9)}  ${new Date(entry.mtimeMs).toISOString()}  ${entry.name}`,
		);
	}
	lines.push('', `Total: ${formatBytes(totalBytes)} across ${entries.length} entries`);
	return lines.join('\n');
}
