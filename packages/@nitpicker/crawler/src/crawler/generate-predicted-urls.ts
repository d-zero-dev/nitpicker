import type { PaginationPattern } from './types.js';

import { decomposeUrl } from './decompose-url.js';
import { reconstructUrl } from './reconstruct-url.js';

/**
 * Generates predicted URLs by extrapolating the detected pagination pattern.
 *
 * Starting from `currentUrl`, applies the pattern's step `count` times to produce
 * future page URLs (e.g. if step=1 and currentNumber=2, generates page 3, 4, ...).
 * These URLs are pushed into the crawl queue and discarded later if they 404.
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

	const results: string[] = [];
	for (let i = 1; i <= count; i++) {
		const nextNum = pattern.currentNumber + pattern.step * i;
		const url = reconstructUrl(decomposed, pattern.tokenIndex, String(nextNum));
		results.push(url);
	}
	return results;
}
