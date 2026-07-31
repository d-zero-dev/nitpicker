import type { PaginationPattern } from './types.js';

import { decomposeUrl } from './decompose-url.js';
import { reconstructUrl } from './reconstruct-url.js';

const DIGITS_ONLY_PATTERN = /^\d+$/;

/**
 * Generates predicted URLs by extrapolating the detected pagination pattern.
 *
 * Starting from `currentUrl`, applies the pattern's step `count` times to produce
 * future page URLs (e.g. if step=1 and currentNumber=2, generates page 3, 4, ...).
 * These URLs are pushed into the crawl queue and discarded later if they 404.
 *
 * Generation stops at the first token that would lose its original digit-string
 * shape, rather than skipping it and continuing: beyond `Number.MAX_SAFE_INTEGER`,
 * `String()` renders scientific notation (e.g. `"1e+21"`), which is not a valid
 * path/query token and — left unguarded — becomes a self-generated URL that no
 * page on the target site ever linked to (observed in production: a
 * `/news/date/{year}/` pager whose per-anchor `step` was miscalculated from
 * unrelated pages, compounding across rounds until it emitted
 * `1.7715854126052197e+120`). A token growing far beyond its original digit
 * count is equally implausible as a next page number. Both trends are
 * monotonic as `i` increases, so once one prediction is rejected, every later
 * one in the same batch would be too — there is nothing to skip past.
 * @param pattern - The detected pagination pattern from `detectPaginationPattern()`
 * @param currentUrl - The URL to extrapolate from (protocol-agnostic, without hash/auth)
 * @param count - Number of predicted URLs to generate (typically equals concurrency)
 * @returns Array of predicted URL strings
 */
export function generatePredictedUrls(
	pattern: PaginationPattern,
	currentUrl: string,
	count: number,
): string[] {
	if (count <= 0) return [];

	const decomposed = decomposeUrl(currentUrl);
	if (!decomposed) return [];

	const { pathSegments, queryValues } = decomposed;
	const originalToken =
		pattern.tokenIndex < pathSegments.length
			? pathSegments[pattern.tokenIndex]
			: queryValues[pattern.tokenIndex - pathSegments.length];
	if (originalToken === undefined) return [];

	// A pager jumping from 4 digits to 5 (e.g. year 9999 → 10000) is plausible;
	// jumping straight to 6+ digits within the same predicted batch is not.
	const maxDigits = originalToken.length + 1;

	const results: string[] = [];
	for (let i = 1; i <= count; i++) {
		const nextNum = pattern.currentNumber + pattern.step * i;
		if (!Number.isSafeInteger(nextNum)) break;

		const rendered = String(nextNum);
		if (!DIGITS_ONLY_PATTERN.test(rendered)) break;

		// Preserve zero-padding width (e.g. "01" → "02"), without truncating a
		// value that has legitimately grown past the original width.
		const padded = rendered.padStart(originalToken.length, '0');
		if (padded.length > maxDigits) break;

		results.push(reconstructUrl(decomposed, pattern.tokenIndex, padded));
	}
	return results;
}
