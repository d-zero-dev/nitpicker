import type { ArchiveAccessor } from '@nitpicker/crawler';

import { findUnmatchedPageListUrls } from './find-unmatched-page-list-urls.js';

/**
 * Warns once, with an unmatched-count summary, when some of a `--urls`
 * filter's normalized URLs matched no Page List row — the shared
 * post-generation notice for every `--urls`-accepting report backend.
 *
 * Not-found entries are never rendered as pseudo-rows in the report itself
 * (a nonexistent page has no data for the report's columns); this is the
 * summary-count half of that design, pointing the operator at `query
 * match-urls` for the per-URL breakdown (redirected / never crawled /
 * outside the report's row-set scope).
 * @param accessor - The archive accessor to query.
 * @param normalizedUrls - URLs already normalized via
 *   `resolveAndValidatePageListUrlFilter`/`resolvePageListUrlFilter`.
 * @param onWarn - Called with no trailing newline when at least one URL was unmatched. Not called at all when every URL matched.
 * @returns Resolves once the check (and any warning) is done.
 * @example
 * await warnUnmatchedPageListUrls(accessor, normalizedUrls, warn);
 */
export async function warnUnmatchedPageListUrls(
	accessor: ArchiveAccessor,
	normalizedUrls: readonly string[],
	onWarn: (message: string) => void,
): Promise<void> {
	const missing = await findUnmatchedPageListUrls(accessor, normalizedUrls);
	if (missing.length > 0) {
		onWarn(
			`--urls: ${missing.length} of ${normalizedUrls.length} URL(s) were not found in the report (not in the archive, redirected, or outside the report's page set). Use \`query match-urls\` for details.`,
		);
	}
}
