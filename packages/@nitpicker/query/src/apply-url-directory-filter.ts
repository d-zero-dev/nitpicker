import type { Knex } from 'knex';

import { parsePageDirectoryPrefix } from './parse-page-directory-prefix.js';

/** `ur.url` after its `scheme://`: authority, path, query and fragment. */
const AFTER_SCHEME = "substr(ur.url, instr(ur.url, '://') + 3)";

/**
 * 1-based index where the authority ends: the first `/`, `?` or `#`, or one
 * past the end when there is none. A root URL can be stored without its
 * slash (`https://example.com?lang=en`), so `/` alone is not the boundary.
 * `?` is spelled `char(63)`: knex reads a `?` anywhere in raw SQL as a
 * binding placeholder, and its `\?` escape reaches the driver unstripped.
 */
const AUTHORITY_END = `min(instr(${AFTER_SCHEME} || '/', '/'), instr(${AFTER_SCHEME} || char(63), char(63)), instr(${AFTER_SCHEME} || '#', '#'))`;

/** The URL's authority (`host[:port]`). */
const AUTHORITY = `substr(${AFTER_SCHEME}, 1, ${AUTHORITY_END} - 1)`;

/** The URL's path plus any query and fragment; `''` for a bare root URL. */
const PATH = `substr(${AFTER_SCHEME}, ${AUTHORITY_END})`;

/**
 * Restricts a page query to one directory: the directory's own page and
 * everything beneath it, with the `/` separator as the boundary — the
 * meaning `report --html-dirs` gives a directory (`parsePageDirectoryPrefix`),
 * applied to `url_refs.url` instead of `viewer_pages` so it works on
 * archives without a viewer read model.
 *
 * `/blog` matches `/blog`, `/blog/`, `/blog?x` and `/blog/2024/post`, and
 * not `/blogging`, `/Blog` or `/en/blog/post`. A pathname filter matches on
 * every host; a full-URL filter (`https://example.com/blog`) also requires
 * the host (scheme and port are not compared, as in
 * `parsePageDirectoryPrefix`).
 *
 * Why not `LIKE`: a `LIKE '%/blog/%'` cannot anchor the path to the start
 * of the URL's path, and treats `%` / `_` in the directory as wildcards
 * (and ASCII case-insensitively, which a URL path is not). The authority
 * and path are cut out of the URL with `instr` / `substr` and compared
 * with `=` only, so the filter text is never a pattern. Each test is one
 * prefix comparison against the cut string with a terminator appended
 * (`path || '/'` starts with `/blog/` exactly when the path is `/blog` or
 * lies under it), so the cut is not repeated per alternative. It is a
 * residual predicate — no index can serve it — like the substring `LIKE`
 * it replaces.
 * @param qb - A query that joins `url_refs` as `ur`.
 * @param directory - A pathname (`/blog`, `blog/`) or a full URL; `/` keeps every page.
 * @throws {TypeError} If `directory` is blank or a URL without a host (see `parsePageDirectoryPrefix`).
 * @example
 * const query = knex('content_items as ci').join('url_refs as ur', 'ur.id', 'ci.url_id');
 * applyUrlDirectoryFilter(query, '/blog');
 */
export function applyUrlDirectoryFilter(qb: Knex.QueryBuilder, directory: string): void {
	const { hostname, pathname } = parsePageDirectoryPrefix(directory);
	if (hostname != null) {
		// `host:port` and `host` both start with `host:` once `:` is appended.
		qb.whereRaw(`substr(${AUTHORITY} || ':', 1, ?) = ?`, [
			hostname.length + 1,
			`${hostname}:`,
		]);
	}
	if (pathname === '') {
		return;
	}
	qb.whereRaw(`substr(${PATH} || '/', 1, ?) IN (?, ?, ?)`, [
		pathname.length + 1,
		`${pathname}/`,
		`${pathname}?`,
		`${pathname}#`,
	]);
}
