import type { ExURL } from '@d-zero/shared/parse-url';

import { isLikelyHtmlUrl } from './is-likely-html-url.js';

/**
 * Split URLs into a likely-HTML group and a non-HTML group, preserving input
 * order within each group.
 *
 * Used by the crawler's enqueue path to route discovered URLs: likely-HTML URLs
 * are `unshift`ed to the front of the dealer queue (so page crawling advances
 * ahead of asset/document fetches) while the rest are `push`ed to the tail.
 * Keeping the order stable within each group means a batch (e.g. predicted
 * pagination URLs) stays in ascending order at the front when unshifted as one
 * call. Classification is delegated to {@link isLikelyHtmlUrl}.
 * @param urls - The discovered URLs to partition.
 * @returns A `[html, other]` tuple: likely-HTML URLs and the remainder, each in
 *   original input order.
 */
export function partitionUrlsByHtml(
	urls: readonly ExURL[],
): [html: ExURL[], other: ExURL[]] {
	const html: ExURL[] = [];
	const other: ExURL[] = [];
	for (const url of urls) {
		(isLikelyHtmlUrl(url) ? html : other).push(url);
	}
	return [html, other];
}
