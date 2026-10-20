import type { SearchPattern } from '@nitpicker/archive/html-snapshot/types';

import { compileSearchPattern } from '@nitpicker/query/compile-search-pattern';

/**
 * Reads the `--pattern` flag of `query search-html` (with `--literal`) and
 * fails with the same message wherever it is checked: before the archive is
 * opened, and again when the flags are mapped to the query's options.
 * @param pattern - The `--pattern` value.
 * @param literal - The `--literal` value.
 * @returns The pattern as the native search takes it.
 * @throws {Error} `Invalid --pattern value: …` with the reason in parentheses,
 *   for any pattern `compileSearchPattern` refuses.
 * @example
 * compilePatternFlag('/static/images/', true); // searched as the text it is
 * compilePatternFlag('/(/', false); // throws: Invalid --pattern value: /(/ (…)
 */
export function compilePatternFlag(
	pattern: string,
	literal: boolean | undefined,
): SearchPattern {
	try {
		return compileSearchPattern(pattern, { literal });
	} catch (error) {
		throw new Error(
			`Invalid --pattern value: ${pattern} (${error instanceof Error ? error.message : String(error)})`,
			{ cause: error },
		);
	}
}
