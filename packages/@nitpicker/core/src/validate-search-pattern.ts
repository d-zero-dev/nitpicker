import type { NativeSearchPattern } from './types.js';

import { nativeBinding } from './native-binding.js';

/**
 * Compiles a `query search-html` pattern and reports whether it matches the
 * empty string.
 *
 * The pattern is a literal, or a regular expression in the syntax of Rust's
 * `regex` crate: backreferences and look-around are not supported, and
 * matching runs in time linear in the document. The addon keeps the last
 * compiled pattern, so a search that follows with the same pattern does not
 * compile it again; this is for refusing a pattern before the archive is
 * opened.
 * @param pattern - The pattern and its flags.
 * @returns Whether the pattern matches the empty string, which `search-html` rejects
 *   because it would match at every position of every snapshot.
 * @throws {Error} With code `InvalidArg` and the regex engine's message if the
 *   pattern is not valid, uses an unsupported construct, or compiles to more than
 *   the engine's size limit.
 * @example
 * ```ts
 * validateSearchPattern({ source: 'a+', literal: false, ignoreCase: false, multiLine: false, dotAll: false }); // false
 * validateSearchPattern({ source: 'a*', literal: false, ignoreCase: false, multiLine: false, dotAll: false }); // true
 * validateSearchPattern({ source: '(?=a)a', literal: false, ignoreCase: false, multiLine: false, dotAll: false }); // throws
 * ```
 */
export function validateSearchPattern(pattern: NativeSearchPattern): boolean {
	return nativeBinding.validateSearchPattern(pattern);
}
