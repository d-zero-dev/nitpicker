import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

/**
 * Longest common prefix across every segment list, compared index by index.
 * Returns the first list's prefix — any list works as the starting point
 * since the result is the intersection of all of them.
 * @param segmentsList
 */
function longestCommonSegmentPrefix(
	segmentsList: readonly (readonly string[])[],
): string[] {
	const [first, ...rest] = segmentsList;
	if (!first) {
		return [];
	}
	let commonLength = first.length;
	for (const segments of rest) {
		let i = 0;
		while (i < commonLength && i < segments.length && segments[i] === first[i]) {
			i++;
		}
		commonLength = i;
		if (commonLength === 0) {
			break;
		}
	}
	return first.slice(0, commonLength);
}

/**
 * Computes the deepest directory shared by every page URL in a group,
 * one entry per distinct origin — a `page_templates.template_key` cluster is
 * usually single-origin, but multi-root archives can classify pages from
 * more than one root into the same template.
 *
 * Groups by full origin (`<scheme>//<host>`), not just host: a hostname
 * mid-migration between `http:` and `https:` (or a stray unresolved
 * protocol-relative URL) would otherwise silently collapse onto whichever
 * scheme happened to be seen first for that host, producing a
 * common-directory URL with a scheme some member pages don't actually use.
 *
 * Uses `ExURL.dirname` (`@d-zero/shared/parse-url`) rather than splitting
 * `pathname` directly: `dirname` already excludes the trailing filename-like
 * segment (e.g. `/recruit/2026/entry` and `/recruit/2026/` both resolve to
 * dirname `/recruit/2026`), so a single-page group's "common directory"
 * never includes that page's own filename.
 *
 * Unparseable URLs are silently skipped (defensive; every URL reaching this
 * function already round-tripped through `url_refs`, so this should not
 * happen in practice).
 * @param urls - Page URLs belonging to one template cluster.
 * @returns One common-directory URL (`<scheme>//<host>/<path>/`) per origin
 *   represented in `urls`, sorted for deterministic output. An origin with
 *   no shared path segment beyond the root yields `<scheme>//<host>/`.
 * @example
 * ```ts
 * computeCommonDirectory([
 *   'https://example.com/recruit/2026/entry',
 *   'https://example.com/recruit/2026/faq',
 * ]);
 * // ['https://example.com/recruit/2026/']
 * ```
 */
export function computeCommonDirectory(urls: readonly string[]): string[] {
	const segmentsByOrigin = new Map<string, string[][]>();

	for (const urlString of urls) {
		const parsed = parseUrl(urlString);
		if (!parsed) {
			continue;
		}
		const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
		const origin = `${parsed.protocol}//${host}`;
		const segments = parsed.dirname
			? parsed.dirname.split('/').filter((segment) => segment.length > 0)
			: [];
		const existing = segmentsByOrigin.get(origin);
		if (existing) {
			existing.push(segments);
		} else {
			segmentsByOrigin.set(origin, [segments]);
		}
	}

	const result: string[] = [];
	for (const [origin, segmentsList] of segmentsByOrigin) {
		const common = longestCommonSegmentPrefix(segmentsList);
		const dirPath = common.length > 0 ? `/${common.join('/')}/` : '/';
		result.push(`${origin}${dirPath}`);
	}
	return result.toSorted();
}
