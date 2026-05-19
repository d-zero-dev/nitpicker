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
 * @param url - The raw resource URL as stored in the archive.
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
	const keys: string[] = [];
	for (const pair of query.split('&')) {
		const eq = pair.indexOf('=');
		const key = eq === -1 ? pair : pair.slice(0, eq);
		if (key.length > 0) {
			keys.push(key);
		}
	}
	keys.sort();
	const unique: string[] = [];
	for (let i = 0; i < keys.length; i++) {
		if (i === 0 || keys[i] !== keys[i - 1]) {
			unique.push(keys[i]!);
		}
	}
	return head + '?' + unique.join('&');
}
