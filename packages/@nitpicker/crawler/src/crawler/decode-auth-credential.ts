/**
 * Decode a percent-encoded userinfo credential (username or password)
 * parsed out of a URL into the literal string the origin server expects.
 *
 * The WHATWG URL parser percent-encodes characters outside the userinfo
 * set (`[`, `]`, `{`, `}`, `=`, `:`, `@`, non-ASCII, …) and keeps the
 * `username` / `password` fields in that encoded form. Consumers that
 * forward credentials out-of-band — `page.authenticate()` for the
 * browser session, the `auth` request option for the HEAD pre-flight —
 * must send the decoded literal, or any credential containing such a
 * character silently authenticates with the wrong string and the server
 * answers 401. Node's own `urlToOptions` applies the same
 * `decodeURIComponent` step for `http.request(url)`.
 *
 * A malformed sequence (a literal `%` the parser left untouched, e.g. a
 * user typing `pa%ssword` without encoding it) would make
 * `decodeURIComponent` throw, so the raw value is returned as a
 * fallback — identical to the pre-decode behavior for that input.
 * @param value - The raw (possibly percent-encoded) credential field, or
 *   `null` when the URL carries no userinfo.
 * @returns The decoded credential, or an empty string for `null` input.
 * @example
 * ```ts
 * const url = parseUrl('https://user:pa%5Dss%7Bword%3D@example.com/')!;
 * decodeAuthCredential(url.password); // => 'pa]ss{word='
 * decodeAuthCredential(null); // => ''
 * ```
 */
export function decodeAuthCredential(value: string | null): string {
	if (!value) {
		return '';
	}
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
