import type { ExURL } from '@d-zero/shared/parse-url';

/**
 * File extensions (lowercased, leading dot included) that typically denote a
 * document served as `text/html`. Both static pages (`.html`) and the common
 * server-side template / handler extensions (`.php`, `.aspx`, `.jsp`, `.ashx`,
 * `.jsf` …) are listed because they usually serve an HTML page.
 *
 * A few entries (`.cgi`, `.do`, `.action`) are ambiguous — they sometimes
 * return JSON or binary — but are kept here because a misclassification only
 * changes fetch order, never correctness (see {@link isLikelyHtmlUrl}).
 *
 * Keys keep the leading dot so they can be compared directly against
 * `ExURL.extname` (Node `Path.extname` output) without stripping it.
 */
const HTML_EXTENSIONS: ReadonlySet<string> = new Set([
	'.html',
	'.htm',
	'.xhtml',
	'.shtml',
	'.mhtml',
	'.php',
	'.php3',
	'.php4',
	'.php5',
	'.phtml',
	'.asp',
	'.aspx',
	'.ashx',
	'.jsp',
	'.jspx',
	'.jsf',
	'.cfm',
	'.cgi',
	'.do',
	'.action',
]);

/**
 * Heuristically decide whether a discovered URL is likely to resolve to an
 * HTML page, based solely on the URL itself.
 *
 * WHY URL-only: this runs at enqueue time — before any HEAD/GET — so the actual
 * `Content-Type` is unknown. The crawler uses the result to prioritise the
 * dealer queue (likely-HTML URLs are `unshift`ed to the front so page crawling
 * advances ahead of asset/document fetches), so a heuristic is acceptable: a
 * misclassification only changes fetch order, never correctness.
 *
 * Classification rules:
 * - Non-HTTP URLs (`mailto:`, `tel:`, …) are never HTML pages.
 * - Extensionless / directory-style URLs (`/`, `/about/`), and bare trailing-dot
 *   URLs (`/index.`, whose `extname` is `"."`), are treated as HTML — these are
 *   the overwhelmingly common shape for navigable pages.
 * - URLs whose extension is in {@link HTML_EXTENSIONS} are HTML; every other
 *   extension (`.jpg`, `.pdf`, `.css`, `.js`, …) is treated as non-HTML.
 * @param url - The parsed URL to classify.
 * @returns `true` when the URL is likely an HTML page.
 */
export function isLikelyHtmlUrl(url: ExURL): boolean {
	if (!url.isHTTP) {
		return false;
	}
	const extname = url.extname;
	if (!extname || extname === '.') {
		return true;
	}
	return HTML_EXTENSIONS.has(extname.toLowerCase());
}
