import type { SearchPattern } from '@nitpicker/archive/html-snapshot/types';

import { validateSearchPattern } from '@nitpicker/archive/html-snapshot/validate-search-pattern';

/**
 * `/source/flags`: the form of a regular expression. `.` does not match a line
 * break, so a pattern with one is always a literal. Any trailing letters from
 * the flag set JavaScript knows make it a regular expression, even `d` `v` `y`,
 * so that those are rejected instead of silently searched as text. Letters
 * outside it (`/assets/js/x`) leave the whole string a literal; so does a
 * string without a closing `/`. A literal that happens to look like this form
 * (`/static/images/` — a leading and a trailing slash — or `/a/s`) is a regular
 * expression, unless the caller asks for a literal (`literal: true`).
 */
// cspell:disable-next-line
const REGEX_FORM = /^\/(.*)\/([dgimsuvy]*)$/;

/** Flags `search-html` does not support; every other flag is `g`, `u`, `i`, `m` or `s`. */
const UNSUPPORTED_FLAGS = new Set(['d', 'v', 'y']);

/**
 * Reads a `search-html` pattern and checks it can run, before any archive is
 * opened.
 *
 * A pattern is plain text (a literal substring) unless it has the form
 * `/source/flags`, in which case `source` is a regular expression in the
 * syntax of Rust's `regex` crate: no backreferences or look-around, the
 * match unit is a Unicode scalar value, `\d` `\w` `\s` `\b` follow
 * Unicode, and matching time is linear in the document. Flags: `i`, `m`,
 * `s` take effect; `g` and `u` are accepted and always on; `d`, `v` and `y`
 * are rejected.
 *
 * With `literal: true` the whole string is the text to find, whatever it
 * looks like (`/static/images/`, `/api/v`); that is the way to search a
 * literal that has the `/…/flags` form.
 *
 * Why a separate module with its own `@nitpicker/query/compile-search-pattern`
 * export: the CLI checks the pattern before it opens the archive, and the
 * CLI's specs replace the `@nitpicker/query` entry point wholesale, which this
 * check should not depend on.
 * @param pattern - The `--pattern` / `pattern` value as given.
 * @param options - Reading options.
 * @param options.literal - Take `pattern` as plain text even if it has the `/…/flags` form.
 * @returns The pattern split into text and flags, as the native search takes it.
 * @throws {SyntaxError} If a flag is not supported, or the regular expression is not valid,
 *   uses an unsupported construct, or is too large; the message says which.
 * @throws {Error} If the pattern matches the empty string, which would match at every
 *   position of every snapshot.
 * @example
 * ```ts
 * compileSearchPattern('fonts.example.org');
 * // { source: 'fonts.example.org', literal: true, ignoreCase: false, multiLine: false, dotAll: false }
 * compileSearchPattern('/UA-\\d+-\\d+/i');
 * // { source: 'UA-\\d+-\\d+', literal: false, ignoreCase: true, multiLine: false, dotAll: false }
 * compileSearchPattern('/static/images/', { literal: true });
 * // { source: '/static/images/', literal: true, ignoreCase: false, multiLine: false, dotAll: false }
 * ```
 */
export function compileSearchPattern(
	pattern: string,
	options?: { readonly literal?: boolean },
): SearchPattern {
	const form = options?.literal ? null : REGEX_FORM.exec(pattern);
	let compiled: SearchPattern;
	if (form) {
		const [, source = '', flags = ''] = form;
		for (const flag of new Set(flags)) {
			if (UNSUPPORTED_FLAGS.has(flag)) {
				throw new SyntaxError(
					`Invalid flag "${flag}" in the search pattern: only i, m and s change the search (g and u are always on). To search the text as it is, search literally (--literal).`,
				);
			}
		}
		compiled = {
			source,
			literal: false,
			ignoreCase: flags.includes('i'),
			multiLine: flags.includes('m'),
			dotAll: flags.includes('s'),
		};
	} else {
		compiled = {
			source: pattern,
			literal: true,
			ignoreCase: false,
			multiLine: false,
			dotAll: false,
		};
	}

	let matchesEmpty: boolean;
	try {
		matchesEmpty = validateSearchPattern(compiled);
	} catch (error) {
		// Only the engine refusing the pattern is the pattern's fault; a binding
		// that failed to load or a panic must reach the user as what it is.
		if ((error as { code?: unknown }).code !== 'InvalidArg') {
			throw error;
		}
		throw new SyntaxError(
			`Invalid regular expression in the search pattern: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
	if (matchesEmpty) {
		throw new Error(
			'pattern must not match the empty string (it would match at every position of every snapshot).',
		);
	}
	return compiled;
}
