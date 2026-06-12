/**
 * The destination of a redirect chain and the source URLs that point at it.
 */
export interface RedirectChain {
	/** The final destination URL the chain lands on (normalised). */
	destUrl: string;
	/**
	 * The source URLs that redirect to {@link destUrl}: the originally requested
	 * URL followed by every intermediate hop. Empty when the page was not
	 * redirected at all.
	 */
	sources: string[];
}

/**
 * Splits a page's redirect chain into its final destination and the list of
 * source URLs that point at it.
 *
 * The archive stores redirects as edges: every source URL carries a
 * `redirectDestId` pointing at the destination page, and only the destination
 * holds content. This helper applies the shared convention — the last entry of
 * `redirectPaths` is the destination, while the originally requested URL plus
 * every intermediate hop are the sources. When the page was not redirected,
 * the destination is the page URL itself and there are no sources.
 *
 * Used by both {@link Database.updatePage} (which renders and stores the
 * destination) and {@link Database.recordRedirect} (the #73 convergence
 * optimisation, which records the edge for a destination already rendered
 * elsewhere without touching its content).
 * @param pageUrl - The originally requested URL (normalised, without hash/auth).
 * @param redirectPaths - The redirect hop URLs captured during fetch, in order.
 * @returns The destination URL and the source URLs pointing to it.
 */
export function resolveRedirectChain(
	pageUrl: string,
	redirectPaths: readonly string[],
): RedirectChain {
	if (redirectPaths.length === 0) {
		return { destUrl: pageUrl, sources: [] };
	}
	const paths = [...redirectPaths];
	const destUrl = paths.pop()!;
	return { destUrl, sources: [pageUrl, ...paths] };
}
