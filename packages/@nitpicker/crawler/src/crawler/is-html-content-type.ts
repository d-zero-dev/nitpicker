/**
 * Determine whether a Content-Type media type is HTML.
 *
 * MIME types are case-insensitive (RFC 2045), and values captured from
 * Puppeteer responses preserve the server's original casing, so the
 * comparison must normalize case — `text/HTML` is HTML.
 * @param contentType - The media type portion of a Content-Type header
 *   (parameters already stripped), or `null` when unknown.
 * @returns `true` when the media type is `text/html` in any letter case.
 */
export function isHtmlContentType(contentType: string | null): boolean {
	return contentType !== null && contentType.toLowerCase() === 'text/html';
}
