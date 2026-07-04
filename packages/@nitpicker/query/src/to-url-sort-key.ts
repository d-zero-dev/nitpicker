import type { UrlSortKey } from './types.js';

import { tryParseUrl } from '@d-zero/shared/parse-url';

/**
 * Parses `url` once and extracts only the fields
 * {@link import('./compare-url-sort-keys.js').compareUrlSortKeys} needs.
 *
 * The parsed `ExURL` itself is not returned, so it becomes eligible for
 * garbage collection as soon as this function returns — the caller only
 * retains the lightweight {@link UrlSortKey}, which matters when this runs
 * for every URL in an archive with a million+ rows.
 *
 * Always returns a key, even when `url` is not a parsable HTTP URL: the
 * `pages`/`resources` row that URL came from must still get a
 * `viewer_url_sort_keys` rank, or `orderByUrlRank`'s scalar subquery finds
 * no match and SQLite sorts that row's `NULL` rank ahead of every real one,
 * bunching every unparsable URL at the very top of every URL-sorted view
 * (the previous whole-archive-in-memory sort avoided this by giving every
 * raw URL a fallback rank via `rankByUrl.get(url) ?? fallbackRank`). The
 * fallback key uses `url` itself as `href` so identical unparsable strings
 * still dedup correctly in {@link
 * import('./merge-sorted-url-chunks.js').mergeSortedUrlChunks} (which keys
 * on `original`/`href` equality), and empty `hostname`/`paths` so it sorts
 * before real hostnames rather than colliding with one.
 * @param url - The URL string to parse.
 * @returns The comparison key. Never `null` — see fallback behavior above.
 * @example
 * const key = toUrlSortKey('https://example.com/image-2.jpg');
 */
export function toUrlSortKey(url: string): UrlSortKey {
	const parsed = tryParseUrl(url);
	if (!parsed) {
		return {
			original: url,
			href: url,
			hostname: '',
			paths: [],
			basename: '',
			isIndex: false,
			extname: '',
			search: '',
			hash: '',
			protocol: '',
		};
	}
	return {
		original: url,
		href: parsed.href,
		hostname: parsed.hostname,
		paths: parsed.paths,
		basename: parsed.basename ?? '',
		isIndex: parsed.isIndex,
		extname: parsed.extname ?? '',
		search: parsed.query ?? '',
		hash: parsed.hash ?? '',
		protocol: parsed.protocol,
	};
}
