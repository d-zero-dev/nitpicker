import type { SearchPattern } from './types.js';

import { validateSearchPattern as validateSearchPatternNatively } from '@nitpicker/core/validate-search-pattern';

/**
 * Compiles a `query search-html` pattern and reports whether it matches the
 * empty string. The pattern is a literal, or a regular expression in the
 * syntax of Rust's `regex` crate (no backreferences or look-around).
 * @param pattern - The pattern and its flags.
 * @returns Whether the pattern matches the empty string, which `search-html` rejects.
 * @throws {Error} With code `InvalidArg` and the regex engine's message if the
 *   pattern is not valid, uses an unsupported construct, or is too large.
 * @example
 * ```ts
 * validateSearchPattern({ source: 'a*', literal: false, ignoreCase: false, multiLine: false, dotAll: false }); // true
 * ```
 */
export function validateSearchPattern(pattern: SearchPattern): boolean {
	return validateSearchPatternNatively(pattern);
}
