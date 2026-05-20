/**
 * Splits a raw query string body (the substring **after** the leading
 * `?`, with no `#fragment` attached) into `(key, value)` pairs in
 * source order. Internal helper shared between {@link canonicalizeUrl}
 * and {@link extractQueryPairs} so the two stay consistent.
 *
 * - No percent-decoding, no sort, no dedupe — callers handle those.
 * - Pairs with an empty key are skipped (matches URL semantics: a
 *   leading `&` or `=value` is ignored).
 * - Pairs without `=` get an empty-string value.
 *
 * Returns an empty array for the empty query string.
 * @param query - The query string body without the leading `?`.
 */
function parseQueryPairs(query: string): Array<{ key: string; value: string }> {
	if (query.length === 0) {
		return [];
	}
	const pairs: Array<{ key: string; value: string }> = [];
	for (const pair of query.split('&')) {
		const eq = pair.indexOf('=');
		const key = eq === -1 ? pair : pair.slice(0, eq);
		if (key.length === 0) {
			continue;
		}
		const value = eq === -1 ? '' : pair.slice(eq + 1);
		pairs.push({ key, value });
	}
	return pairs;
}

/**
 * Canonicalize a resource URL by stripping query parameter *values*
 * while preserving every other part of the URL.
 *
 * - Scheme / host / port / path are returned verbatim.
 * - The query string is rewritten to a sorted, deduplicated list of
 *   parameter keys joined by `&`, with all values discarded.
 * - URLs without a query string are returned unchanged.
 *
 * This is intentionally simpler than {@link URL}/`URLSearchParams`: it
 * neither percent-decodes nor reorders anything outside the query
 * string, so two raw URLs that differ only in per-request query values
 * collapse to the same canonical form without changing path-embedded
 * identifiers (e.g. tracking IDs in `/pagead/viewthroughconversion/<id>/`).
 * @param url - The raw resource URL as stored in the archive. The
 *   archive stores URLs in `withoutHash` form (no `#fragment`); if
 *   you pass a URL with a fragment, the fragment will leak into the
 *   last value but the canonical key list is unaffected.
 * @returns The canonicalized URL.
 * @example
 * ```ts
 * canonicalizeUrl('https://x.com/p/123?b=Y&a=X&a=Z');
 * // → 'https://x.com/p/123?a&b'
 * ```
 */
export function canonicalizeUrl(url: string): string {
	const qIndex = url.indexOf('?');
	if (qIndex === -1) {
		return url;
	}
	const head = url.slice(0, qIndex);
	const query = url.slice(qIndex + 1);
	if (query.length === 0) {
		return head + '?';
	}
	const pairs = parseQueryPairs(query);
	const keys = pairs.map((pair) => pair.key).toSorted();
	const unique: string[] = [];
	for (let i = 0; i < keys.length; i++) {
		if (i === 0 || keys[i] !== keys[i - 1]) {
			unique.push(keys[i]!);
		}
	}
	return head + '?' + unique.join('&');
}

/**
 * Parses the query string of a URL and returns its `(key, value)` pairs
 * in source order. Keys are kept as written (no percent-decoding, no
 * sort, no dedupe) so callers can distinguish e.g. `a=1&a=2` as two
 * separate pairs. Values are the raw substring after the first `=`;
 * pairs with no `=` get an empty-string value, and pairs with no key
 * are skipped.
 *
 * Returns an empty array for URLs without a query string or with an
 * empty query string.
 *
 * **Fragment caveat:** This function does not strip `#fragment` from
 * the URL. The archive's `resources.url` column already stores URLs
 * in `withoutHash` form so this is normally a no-op, but callers
 * passing in arbitrary URLs should strip the fragment first if they
 * care about clean values.
 * @param url - The raw resource URL as stored in the archive.
 * @example
 * ```ts
 * extractQueryPairs('https://x.com/p?a=1&b=2&a=3');
 * // → [{ key: 'a', value: '1' }, { key: 'b', value: '2' }, { key: 'a', value: '3' }]
 * ```
 */
export function extractQueryPairs(
	url: string,
): Array<{ readonly key: string; readonly value: string }> {
	const qIndex = url.indexOf('?');
	if (qIndex === -1) {
		return [];
	}
	return parseQueryPairs(url.slice(qIndex + 1));
}
