const INDEX_SUFFIX_PATTERN = /\/index\.\w+/gi;

/**
 * Normalizes `/index.{ext}` path suffixes (`/index.html`, `/index.php`, ...)
 * to a bare trailing `/` throughout the given text, so that two otherwise
 * identical bodies that differ only in which equivalent URL form a template
 * happened to render (`/about/` vs `/about/index.html`) hash the same.
 *
 * Applied as a blanket string sweep over the whole body — not scoped to
 * `href`/`src` attribute values — because the same trailing-suffix variance
 * can appear anywhere a URL-shaped string is rendered as text (breadcrumbs,
 * "print this page" widgets, JSON embedded in an inline `<script>`), and the
 * body is treated as an opaque string for masking purposes (see
 * `computeBodyHash`).
 * @param body - The `<body>` inner HTML (or any text) to normalize.
 * @returns `body` with every `/index.{ext}` suffix collapsed to `/`.
 */
export function normalizeUrlLikeStrings(body: string): string {
	return body.replaceAll(INDEX_SUFFIX_PATTERN, '/');
}
