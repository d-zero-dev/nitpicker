import type { SearchPattern, SnapshotSearchOutcome } from './types.js';

import { searchHtmlDocument as searchHtmlDocumentNatively } from '@nitpicker/core/search-html-document';

/**
 * Counts the occurrences of a search pattern in one stored HTML document and
 * cuts a snippet around the first. The document is read as UTF-8 (an invalid
 * sequence becomes U+FFFD); positions and lengths are in Unicode scalar
 * values; `matchCount` counts non-overlapping matches; the snippet is a
 * window of `snippetLength` characters centred on the first match, with
 * whitespace collapsed and the ends trimmed.
 * @param options - The pattern and the document.
 * @param options.pattern - The pattern and its flags.
 * @param options.html - The stored markup, as a string or as UTF-8 bytes.
 * @param options.snippetLength - Window size in characters.
 * @returns The match count and the snippet (empty when nothing matched).
 * @throws {Error} With code `InvalidArg` if the pattern cannot be compiled.
 * @example
 * ```ts
 * const { matchCount } = searchHtmlDocument({
 * 	pattern: { source: 'a+', literal: false, ignoreCase: false, multiLine: false, dotAll: false },
 * 	html: '<p>aa b a</p>',
 * 	snippetLength: 20,
 * });
 * matchCount; // 2
 * ```
 */
export function searchHtmlDocument(options: {
	readonly pattern: SearchPattern;
	readonly html: string | Uint8Array;
	readonly snippetLength: number;
}): SnapshotSearchOutcome {
	return searchHtmlDocumentNatively(options);
}
