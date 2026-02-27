import type { ScrapeResult } from '@d-zero/beholder';

import { isError } from '@d-zero/beholder';

/**
 * Determines whether a predicted URL's scrape result should be discarded.
 *
 * Predicted URLs are pre-emptively pushed into the crawl queue before
 * knowing if they exist. This function filters out invalid results:
 * - `error` type → discard (server unreachable, timeout, etc.)
 * - `skipped` type → discard (matched exclusion rule)
 * - `success` with HTTP error status (4xx/5xx) → discard
 * - `success` with 2xx/3xx → keep
 * @param result - The scrape result for the predicted URL
 * @returns `true` if the result should be discarded (not saved to archive)
 */
export function shouldDiscardPredicted(result: ScrapeResult): boolean {
	switch (result.type) {
		case 'error': {
			return true;
		}
		case 'skipped': {
			return true;
		}
		case 'success': {
			if (!result.pageData) return true;
			return isError(result.pageData.status);
		}
		default: {
			return true;
		}
	}
}
