import type { DecomposedUrl } from './types.js';

import { computeContentHash } from './compute-content-hash.js';

/**
 * URL schemes whose "pathname" is really an in-band opaque payload
 * (base64-encoded image bytes, javascript source, blob URL fragment,
 * etc.) rather than a routing key. For these schemes we leave
 * `DecomposedUrl.path` as `null` so the indexed `url_refs.path` column
 * does not balloon with per-URL opaque tails and defeat the dedup goal.
 */
const OPAQUE_PATH_SCHEMES: ReadonlySet<string> = new Set([
	'data',
	'blob',
	'javascript',
	'about',
]);

/**
 * Extracts `scheme` / `host` / `port` / `path` / `query_hash` / `fragment`
 * columns from a URL string for `url_refs` population.
 *
 * Parsing is done via WHATWG `new URL(...)`. URLs that fail to parse (e.g.
 * a malformed href scraped from the wild) still round-trip through
 * `url_refs` — the natural key is the raw `url` string — but every
 * decomposed column becomes `null` so filters that JOIN on `host` or
 * `scheme` cleanly skip malformed rows instead of falsely matching.
 *
 * `port` is only populated when explicit in the URL. `new URL(...)`
 * normalises the scheme's default port away (`https://example.com:443/` →
 * `url.port === ''`), so we never synthesise a default. Two rows differing
 * only by explicit vs implicit default port must not deduplicate anyway —
 * `url_refs.url` (the raw string) is the natural key, not the decomposed
 * columns.
 *
 * `query_hash` is the 32-byte content hash of the query string with the
 * leading `?` stripped. Storing the raw query would defeat dedup on
 * tracker URLs whose per-request keys explode dictionary size.
 * @param url - Raw URL string (may be any WHATWG-parseable form, or malformed).
 * @returns Every column that goes into `url_refs` alongside the raw URL.
 */
export function decomposeUrl(url: string): DecomposedUrl {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return {
			scheme: null,
			host: null,
			port: null,
			path: null,
			query_hash: null,
			fragment: null,
		};
	}

	const scheme = parsed.protocol.slice(0, -1) || null;
	const host = parsed.hostname === '' ? null : parsed.hostname.toLowerCase();
	const port = parsed.port === '' ? null : Number.parseInt(parsed.port, 10);
	const rawSearch = parsed.search.startsWith('?')
		? parsed.search.slice(1)
		: parsed.search;
	const query_hash = rawSearch === '' ? null : computeContentHash(rawSearch);
	const fragment = parsed.hash === '' ? null : parsed.hash.slice(1);
	const path =
		scheme !== null && OPAQUE_PATH_SCHEMES.has(scheme) ? null : parsed.pathname;

	return {
		scheme,
		host,
		port: port !== null && Number.isFinite(port) ? port : null,
		path,
		query_hash,
		fragment,
	};
}
