/**
 * One `(key, value)` pair from a URL's query string, in source order, kept
 * as written (no percent-decoding, no sort, no dedupe).
 */
export interface QueryPair {
	readonly key: string;
	readonly value: string;
}

/**
 * Splits a raw query string body (the substring after the leading `?`, with
 * no `#fragment` attached) into `(key, value)` pairs in source order.
 *
 * - No percent-decoding, no sort, no dedupe — callers handle those.
 * - Pairs with an empty key are skipped (matches URL semantics: a leading
 *   `&` or `=value` is ignored).
 * - Pairs without `=` get an empty-string value.
 *
 * Returns an empty array for the empty query string.
 * @param query - The query string body without the leading `?`.
 */
function parseQueryPairs(query: string): QueryPair[] {
	if (query.length === 0) {
		return [];
	}
	const pairs: QueryPair[] = [];
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
 * Canonicalizes a resource URL by stripping query parameter *values* while
 * preserving every other part of the URL, and returns its query
 * `(key, value)` pairs in the same pass.
 *
 * - Scheme / host / port / path are returned verbatim in `canonical`.
 * - `canonical`'s query string is rewritten to a sorted, deduplicated list
 *   of parameter keys joined by `&`, with all values discarded.
 * - `pairs` preserves every raw `(key, value)` pair in source order
 *   (duplicates included), for per-key value-cardinality tracking.
 * - A URL without a query string returns `canonical` unchanged and an
 *   empty `pairs` array.
 *
 * Computes both derived values (the canonical URL and the query pairs) in
 * a single parse of the query string, rather than two independent
 * functions each re-parsing it: the resource dedupe aggregation this feeds
 * (`computeResourceGroupRows`) needs both values for the same raw URL on
 * every row it processes.
 *
 * This is intentionally simpler than {@link URL}/`URLSearchParams`: it
 * neither percent-decodes nor reorders anything outside the query string,
 * so two raw URLs that differ only in per-request query values collapse to
 * the same canonical form without changing path-embedded identifiers (e.g.
 * tracking IDs in `/pagead/viewthroughconversion/<id>/`).
 * @param url - The raw resource URL as stored in the archive. The archive
 *   stores URLs in `withoutHash` form (no `#fragment`); if you pass a URL
 *   with a fragment, the fragment will leak into the last value but the
 *   canonical key list is unaffected.
 * @example
 * canonicalizeUrlWithQueryPairs('https://x.com/p/123?b=Y&a=X&a=Z');
 * // → {
 * //   canonical: 'https://x.com/p/123?a&b',
 * //   pairs: [{ key: 'b', value: 'Y' }, { key: 'a', value: 'X' }, { key: 'a', value: 'Z' }],
 * // }
 */
export function canonicalizeUrlWithQueryPairs(url: string): {
	readonly canonical: string;
	readonly pairs: readonly QueryPair[];
} {
	const qIndex = url.indexOf('?');
	if (qIndex === -1) {
		return { canonical: url, pairs: [] };
	}
	const head = url.slice(0, qIndex);
	const query = url.slice(qIndex + 1);
	if (query.length === 0) {
		return { canonical: `${head}?`, pairs: [] };
	}
	const pairs = parseQueryPairs(query);
	const keys = pairs.map((pair) => pair.key).toSorted();
	const uniqueKeys: string[] = [];
	for (let i = 0; i < keys.length; i++) {
		if (i === 0 || keys[i] !== keys[i - 1]) {
			uniqueKeys.push(keys[i]!);
		}
	}
	return { canonical: `${head}?${uniqueKeys.join('&')}`, pairs };
}
