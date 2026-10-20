import type { NativeSearchPattern, SnapshotSearchOutcome } from './types.js';

import { nativeBinding } from './native-binding.js';

/**
 * Counts the occurrences of a search pattern in one stored HTML document and
 * cuts a snippet around the first.
 *
 * The document is read as UTF-8 (an invalid sequence becomes U+FFFD, as
 * `Buffer#toString('utf8')` reads it). Positions and lengths are in Unicode
 * scalar values, so `.` matches an emoji once. `matchCount` counts
 * non-overlapping matches as Rust's `find_iter` walks them; the snippet is a
 * window of `snippetLength` characters centred on the first match, with
 * whitespace collapsed (JavaScript's `\s`) and the ends trimmed.
 * @param options - The pattern and the document.
 * @param options.pattern - The pattern and its flags.
 * @param options.html - The stored markup, as a string or as UTF-8 bytes.
 * @param options.snippetLength - Window size in characters.
 * @returns The match count and the snippet (empty when nothing matched).
 * @throws {Error} With code `InvalidArg` if the pattern cannot be compiled (see `validateSearchPattern`).
 * @example
 * ```ts
 * const { matchCount, snippet } = searchHtmlDocument({
 * 	pattern: { source: 'font-family', literal: true, ignoreCase: false, multiLine: false, dotAll: false },
 * 	html: '<style>p { font-family: serif }</style>',
 * 	snippetLength: 20,
 * });
 * matchCount; // 1
 * ```
 */
export function searchHtmlDocument(options: {
	readonly pattern: NativeSearchPattern;
	readonly html: string | Uint8Array;
	readonly snippetLength: number;
}): SnapshotSearchOutcome {
	const { pattern, html, snippetLength } = options;
	return nativeBinding.searchHtmlDocument(
		pattern,
		typeof html === 'string' ? Buffer.from(html, 'utf8') : html,
		snippetLength,
	);
}
