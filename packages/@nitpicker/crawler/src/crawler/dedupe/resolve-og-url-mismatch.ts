import type { Meta } from '@d-zero/beholder';

/**
 * Determines whether a page's (absolutised) `og:url` points somewhere other
 * than the page itself — one of the two confidence signals that lower the
 * effective same-cluster cap threshold (see `DedupeCapTracker`). A pager
 * trap's `og:url` typically still points at the parent listing page rather
 * than the (fake) paginated URL, which this signal is built to catch.
 *
 * Duplicates the tiny URL-absolutisation logic from
 * `../../archive/meta/derive-flat-from-meta.ts` rather than importing it:
 * that file exports only `deriveFlatFromMeta` (one export per file is a
 * project convention), so its internal `absolutizeUrl` helper is not
 * reachable from here. `og:url` arrives un-absolutised (beholder extracts it
 * via `getAttribute`, preserving relative URLs as-written) — comparing it to
 * the page's own absolute URL without resolving it first would treat every
 * relative self-reference (e.g. `content="./"`) as a mismatch, inflating
 * this signal on ordinary pages.
 * @param meta - Beholder-derived metadata for the page.
 * @param pageUrl - The page's own absolute URL.
 * @returns `true` if `og:url` is present and resolves to a URL different
 *   from `pageUrl`; `false` if absent (no signal) or if it resolves to the
 *   same URL.
 * @example
 * ```ts
 * resolveOgUrlMismatch({ title: '', og: { url: '/news' } } as Meta, 'https://example.com/news/date/2024/');
 * // => true — og:url points at the parent listing, not this page
 * resolveOgUrlMismatch({ title: '', og: { url: './' } } as Meta, 'https://example.com/');
 * // => false — relative self-reference resolves to the same URL
 * ```
 */
export function resolveOgUrlMismatch(meta: Meta, pageUrl: string): boolean {
	const raw = meta.og?.url;
	if (!raw) return false;
	try {
		return new URL(raw, pageUrl).href !== pageUrl;
	} catch {
		return false;
	}
}
