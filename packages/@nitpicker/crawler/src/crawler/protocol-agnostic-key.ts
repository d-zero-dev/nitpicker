/**
 * Returns a URL string with the protocol prefix (`http:` / `https:`) stripped.
 *
 * Used as a deduplication key so that HTTP and HTTPS variants of the
 * same URL are treated as identical during crawling.
 * @param url - A URL string (e.g. `"https://example.com/page"`)
 * @returns The URL without its protocol prefix (e.g. `"//example.com/page"`)
 */
export function protocolAgnosticKey(url: string): string {
	return url.replace(/^https?:/, '');
}
