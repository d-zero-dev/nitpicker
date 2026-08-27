/**
 * Returns an `http:` / `https:` href suitable for a static `file://` report,
 * or `undefined` when the string is not a navigable HTTP(S) URL (`javascript:`,
 * `data:`, relative junk from a corrupted archive).
 * @param url - A crawled page URL, used as both link text and candidate href.
 * @returns The URL when it is HTTP(S), otherwise `undefined`.
 * @example
 * toHttpHref('https://example.com/docs');
 * // → 'https://example.com/docs'
 * toHttpHref('javascript:alert(1)');
 * // → undefined
 */
export function toHttpHref(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return url;
		}
	} catch {
		// Not a URL; render as plain text.
	}
	return undefined;
}
