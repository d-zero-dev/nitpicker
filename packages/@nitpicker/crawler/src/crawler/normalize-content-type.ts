/**
 * Canonicalizes a Content-Type media type for storage.
 *
 * MIME types are case-insensitive (RFC 2045) and may arrive with surrounding
 * whitespace (e.g. `text/html ` left after stripping the `; charset=...`
 * parameter). Responses are recorded verbatim (`header.split(';')[0]`) without
 * normalization, so `Text/HTML` or `text/html ` can otherwise reach the
 * database. Storing the canonical (trimmed, lower-cased) form lets the exact
 * SQL page-ness predicate (`WHERE contentType = 'text/html'`) agree with the
 * code-level {@link isHtmlContentType} check, which trims and lower-cases.
 * @param contentType - The raw media type, or `null` when unknown.
 * @returns The trimmed, lower-cased media type, or `null` when unknown/blank.
 */
export function normalizeContentType(contentType: string | null): string | null {
	if (contentType === null) {
		return null;
	}
	const normalized = contentType.trim().toLowerCase();
	return normalized === '' ? null : normalized;
}
