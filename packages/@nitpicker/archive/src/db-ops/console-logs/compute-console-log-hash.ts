import type { ConsoleLogContent } from './types.js';

import { computeContentHash } from '../../populate-ref-tables/compute-content-hash.js';

/**
 * Computes the `console_log_items.hash` for one console log entry's content.
 *
 * Hashing over the raw content fields (not their resolved ref ids) keeps the
 * dictionary row's identity independent of ref-table state, matching
 * `text_refs` / `json_refs` / `url_refs`, whose hash columns are likewise
 * computed from source content rather than downstream ids. The same
 * message logged by a shared framework on every page therefore hashes to
 * the same value regardless of insertion order or which page's scrape
 * resolves the dictionary row first.
 * @param entry - The content fields to hash. `argsJson` must already be
 *   `stringifyConsoleLogArgs`'s output — this function does not
 *   re-serialize `args` itself.
 * @returns 32-byte SHA-256 hash, ready for the `hash BLOB UNIQUE` column.
 * @example
 * const hash = computeConsoleLogHash({ type: 'error', text: 'boom', argsJson: null });
 */
export function computeConsoleLogHash(entry: ConsoleLogContent): Buffer {
	const canonical = JSON.stringify([
		entry.type,
		entry.text,
		entry.argsJson,
		entry.location?.url ?? null,
		entry.location?.lineNumber ?? null,
		entry.location?.columnNumber ?? null,
		entry.stack ?? null,
	]);
	return computeContentHash(canonical);
}
