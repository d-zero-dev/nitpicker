import type { AliasKeys } from './types.js';

import { nativeBinding } from './native-binding.js';

/**
 * Computes the two keys under which pages are grouped as the same page under
 * another URL, parsing `url` once.
 *
 * Both keys read the URL as written (`pathname` and `search` as the WHATWG
 * URL serializes them) and are `host[:port]path[?query]`:
 *
 * - **Tier A** folds what is safe to treat as one resource from the URL
 *   alone: the scheme (a default port is left out, so `http` and `https`
 *   share a key), the host's case, and a trailing `/index.{ext}`.
 * - **Tier B** is Tier A with one trailing `/` of the path dropped (the path
 *   `/` stays): a weaker signal, so a caller confirms it by comparing the
 *   page content.
 *
 * The fragment is never part of a key, and an empty query is no query.
 * @param url - The URL string.
 * @returns Both keys, or `null` for a string that does not parse and for a
 *   URL that is not `http` or `https` (such a URL is left out of alias
 *   grouping).
 * @example
 * ```ts
 * computeAliasKeys('http://Example.com/about/index.html');
 * // { tierA: 'example.com/about/', tierB: 'example.com/about' }
 * computeAliasKeys('mailto:a@example.com'); // null
 * ```
 */
export function computeAliasKeys(url: string): AliasKeys | null {
	return nativeBinding.computeAliasKeys(url);
}
