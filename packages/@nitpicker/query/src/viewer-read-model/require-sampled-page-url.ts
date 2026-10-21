/**
 * The URL of a referrer page that a resource group sampled for its note.
 *
 * A group keeps the ids of its sampled referrers and the URLs are looked up
 * once afterwards (see `computeResourceGroupRows`). Every sampled id came from
 * an edge read in the same transaction through joins to `content_items` and
 * `url_refs`, so a missing URL means those rows changed underneath the build
 * or the two queries disagree. It throws rather than dropping the sample: a
 * dropped sample would silently shorten the note, and the note's "and N more"
 * count would then claim a referrer that was never shown.
 * @param urlByPageId - Page id → URL, as looked up for every sampled page.
 * @param pageId - A sampled referrer page id.
 * @returns The page's URL.
 * @throws {Error} When `urlByPageId` has no URL for `pageId`.
 * @example
 * requireSampledPageUrl(new Map([[7, 'https://example.com/a']]), 7); // 'https://example.com/a'
 */
export function requireSampledPageUrl(
	urlByPageId: ReadonlyMap<number, string>,
	pageId: number,
): string {
	const url = urlByPageId.get(pageId);
	if (url === undefined) {
		throw new Error(
			`requireSampledPageUrl: sampled referrer page ${pageId} has no URL (its edge was read in this transaction, so its content_items and url_refs rows must exist)`,
		);
	}
	return url;
}
