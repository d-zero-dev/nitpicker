import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

/**
 * Extracts the last path segment (filename, with extension) from one
 * stylesheet URL, e.g. `https://example.com/assets/common.css?v=1` →
 * `common.css`. Falls back to the full URL when it doesn't parse or has no
 * filename-like segment (a directory-only URL, or a `data:` URI) —
 * defensive; every stylesheet URL reaching this function already
 * round-tripped through `url_refs`.
 * @param url
 */
function stylesheetFileName(url: string): string {
	const parsed = parseUrl(url);
	if (!parsed || parsed.basename === null) {
		return url;
	}
	return `${parsed.basename}${parsed.extname ?? ''}`;
}

/**
 * Derives the display filenames for a cluster's common stylesheet URLs,
 * deduplicated.
 *
 * Must run server-side (in `@nitpicker/query`, not the viewer frontend):
 * `@d-zero/shared/parse-url`'s `tryParseUrl` imports Node's `node:path` for
 * its `basename`/`extname` derivation, which Vite externalizes rather than
 * polyfills in a browser build — a prior attempt to call this logic
 * directly from `template-clusters-view.tsx` built without error but
 * silently produced unusable output in the browser (`basename` resolved to
 * nothing), so the full URL rendered instead of a filename.
 *
 * Deduplication matters because distinct URLs differing only by query
 * string (e.g. cache-busting `style.css?v=1` vs `style.css?v=2`) resolve to
 * the same filename — without it, a heading built from this list would read
 * as a nonsensical "style.css, style.css" (observed against a real site's
 * common stylesheet set).
 * @param urls - A cluster's common stylesheet URLs (e.g.
 *   {@link import('./compute-css-intersection.js').computeCssIntersection}'s
 *   output).
 * @returns Deduplicated filenames, in first-seen order.
 * @example
 * ```ts
 * computeStylesheetFileNames([
 *   'https://example.com/style.css?v=1',
 *   'https://example.com/theme/style.css?v=2',
 * ]);
 * // ['style.css']
 * ```
 */
export function computeStylesheetFileNames(urls: readonly string[]): string[] {
	return [...new Set(urls.map(stylesheetFileName))];
}
