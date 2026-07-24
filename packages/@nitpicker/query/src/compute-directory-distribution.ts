import type { DirectoryDistributionEntry } from './types.js';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

/**
 * Default number of top directories returned when the caller doesn't
 * specify one — enough to show a large cluster's sectional spread (see
 * this function's own JSDoc) without the list itself becoming the thing a
 * viewer has to scroll past.
 */
const DEFAULT_TOP_N = 5;

/**
 * Computes the most common first-path-segment directories across a group of
 * page URLs, one distribution per distinct origin, ranked by page count.
 *
 * **Deliberately a frequency distribution, not a single deepest common
 * prefix.** An earlier version of this function returned the longest
 * shared path prefix across every URL — correct for a cluster confined to
 * one section, but a large `page_templates.template_key` cluster routinely
 * spans several top-level sections (e.g. `/recruit/`, `/business/`,
 * `/news/` all sharing one DOM-structure template). A single shared prefix
 * across sections like that collapses to the site root, discarding the
 * sectional pattern entirely — a real archive showed clusters of 200+
 * pages reporting nothing but the origin as their "common directory".
 * Grouping by first path segment and ranking by page count surfaces that
 * pattern instead.
 *
 * Only the first path segment is used (not the full `dirname` the prior
 * version used): going deeper would fragment a section's own sub-pages
 * (`/recruit/fresh/`, `/recruit/mid-career/`, ...) into separate entries,
 * which is the opposite of what a caller trying to see the cluster's
 * sectional spread wants.
 *
 * Groups by full origin (`<scheme>//<host>`), not just host: a hostname
 * mid-migration between `http:` and `https:` (or a stray unresolved
 * protocol-relative URL) would otherwise silently collapse onto whichever
 * scheme happened to be seen first for that host.
 *
 * Unparseable URLs are silently skipped (defensive; every URL reaching this
 * function already round-tripped through `url_refs`, so this should not
 * happen in practice).
 * @param urls - Page URLs belonging to one template cluster.
 * @param topN - Maximum number of directories to return, ranked by page
 *   count descending (ties broken by directory URL, ascending). Defaults to
 *   {@link DEFAULT_TOP_N}.
 * @returns Up to `topN` directory/page-count entries. Callers that need the
 *   remainder (pages outside the top `topN`) can subtract the sum of
 *   returned `pageCount`s from `urls.length`.
 * @example
 * ```ts
 * computeDirectoryDistribution([
 *   'https://example.com/recruit/fresh',
 *   'https://example.com/recruit/mid-career',
 *   'https://example.com/business/',
 * ]);
 * // [
 * //   { directory: 'https://example.com/recruit/', pageCount: 2 },
 * //   { directory: 'https://example.com/business/', pageCount: 1 },
 * // ]
 * ```
 */
export function computeDirectoryDistribution(
	urls: readonly string[],
	topN: number = DEFAULT_TOP_N,
): DirectoryDistributionEntry[] {
	const countByDirectory = new Map<string, number>();

	for (const urlString of urls) {
		const parsed = parseUrl(urlString);
		if (!parsed) {
			continue;
		}
		const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
		const origin = `${parsed.protocol}//${host}`;
		const segments = parsed.dirname
			? parsed.dirname.split('/').filter((segment) => segment.length > 0)
			: [];
		const firstSegment = segments[0];
		const directory = firstSegment ? `${origin}/${firstSegment}/` : `${origin}/`;
		countByDirectory.set(directory, (countByDirectory.get(directory) ?? 0) + 1);
	}

	return [...countByDirectory.entries()]
		.map(([directory, pageCount]) => ({ directory, pageCount }))
		.toSorted((a, b) => b.pageCount - a.pageCount || (a.directory < b.directory ? -1 : 1))
		.slice(0, topN);
}
