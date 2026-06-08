/**
 * Determine whether a Content-Type media type is HTML.
 *
 * MIME types are case-insensitive (RFC 2045), and values captured from
 * Puppeteer responses preserve the server's original casing, so the
 * comparison must normalize case — `text/HTML` is HTML. Surrounding
 * whitespace (e.g. `text/html ` left over after parameter stripping)
 * is also tolerated.
 *
 * This is the single source of truth for HTML detection — `Page.isPage()`
 * and the link list delegate here so the classification never diverges
 * between code paths.
 * @param contentType - The media type portion of a Content-Type header
 *   (parameters already stripped), or `null` when unknown.
 * @returns `true` when the media type is `text/html` in any letter case.
 */
export function isHtmlContentType(contentType: string | null): boolean {
	return contentType !== null && contentType.trim().toLowerCase() === 'text/html';
}
