import type { PageDirectoryPrefix } from './types.js';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

/**
 * Matches a filter written as an absolute URL (`https://example.com/blog`),
 * as opposed to a bare pathname (`/blog`). Deliberately scheme-agnostic in
 * the pattern itself — the scheme is validated by the parse below (only
 * HTTP(S) URLs have a `hostname` to filter on).
 */
const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:\/\//iu;

/**
 * Normalises a pathname into the form stored in `viewer_pages.path_sort_key`
 * minus its trailing slash: leading slash guaranteed, repeated slashes
 * collapsed (`parse-url` does the same when deriving `pathname`), query and
 * hash dropped, trailing slashes removed so `/blog` and `/blog/` produce one
 * key. The site root collapses to `''`, meaning "no path restriction".
 * @param raw - A pathname, possibly with a query/hash and without a leading slash.
 * @returns The normalised pathname prefix.
 */
function normalizePathname(raw: string): string {
	const withoutQuery = raw.split(/[?#]/u)[0] ?? '';
	const absolute = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
	return absolute.replaceAll(/\/+/gu, '/').replace(/\/$/u, '');
}

/**
 * Parses one directory-prefix filter into the `viewer_pages` columns it is
 * matched against (see {@link PageDirectoryPrefix}).
 *
 * Two spellings are accepted, because a report caller has both at hand: an
 * absolute URL (typically an archive root, so the host matters — a
 * multi-root archive can hold the same `/blog/` path under two hosts) and a
 * bare pathname (host-agnostic, which is what a single-root archive wants
 * and what slices one path across every root).
 *
 * Matching is host + pathname only. The scheme is not compared even when the
 * filter carries one: a filter written `http://example.com/blog` against an
 * https archive would otherwise silently match nothing, and no archive
 * distinguishes the two hosts by scheme. The port is likewise not compared —
 * `viewer_pages` stores `hostname` (port excluded) and no port column, so
 * `example.com:8080` and `example.com` are one host here.
 *
 * A pathname-only filter is compared verbatim against
 * `viewer_pages.path_sort_key`, which holds the URL's percent-encoded
 * pathname — a filter containing non-ASCII or space characters must be
 * supplied percent-encoded (a full-URL filter is encoded for the caller by
 * URL parsing).
 * @param filter - A full URL (`https://example.com/blog/`) or a pathname
 *   (`/blog`, `blog` — the leading slash is optional). `/` names the whole
 *   site.
 * @returns The parsed prefix.
 * @throws {TypeError} If `filter` is blank, or is URL-shaped but has no
 *   host to filter on (unparseable, or a non-HTTP scheme).
 * @example
 * parsePageDirectoryPrefix('https://example.com/blog/');
 * // → { hostname: 'example.com', pathname: '/blog' }
 * parsePageDirectoryPrefix('/blog');
 * // → { hostname: null, pathname: '/blog' }
 */
export function parsePageDirectoryPrefix(filter: string): PageDirectoryPrefix {
	if (filter.trim() === '') {
		throw new TypeError(
			'parsePageDirectoryPrefix: filter must not be blank (omit the option to list every directory)',
		);
	}
	if (!ABSOLUTE_URL.test(filter)) {
		return { hostname: null, pathname: normalizePathname(filter) };
	}
	const parsed = parseUrl(filter);
	if (!parsed?.hostname) {
		throw new TypeError(
			`parsePageDirectoryPrefix: filter is not an HTTP(S) URL with a host: ${filter}`,
		);
	}
	return {
		hostname: parsed.hostname,
		pathname: normalizePathname(parsed.pathname ?? ''),
	};
}
