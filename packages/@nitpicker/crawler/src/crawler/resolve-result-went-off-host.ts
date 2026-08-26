import type { BrowserScrapeResult } from './types.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

/**
 * Determines whether a scrape result's actual destination ended up on a
 * different host than the URL that was requested.
 *
 * Exists for the cross-host-redirect leak guard in `Crawler`'s worker body:
 * beholder decides `isExternal: false` before navigating and only flips it
 * to `true` after seeing the destination's hostname, so a same-host source
 * that redirects cross-host still has its sub-resource / console listeners
 * attached under the pre-navigation `isExternal: false` for the whole trip
 * — the caller uses this function's answer to decide whether to discard
 * what those listeners captured.
 *
 * `pageData` (present on `type: 'success'`) carries the authoritative
 * post-navigation `isExternal` and is used directly. A `type: 'error'`
 * result has no `pageData`, so `postNavigationUrl` — the puppeteer-side
 * `page.url()` captured by the JS-redirect rescue (see `BrowserScrapeResult`
 * JSDoc) — is used as the fallback signal instead. When neither is
 * available (e.g. the browser context died before `page.url()` could be
 * read, or the result is `type: 'skipped'`, which carries neither field),
 * this returns `false` — the alternative would discard legitimate
 * console/resource data for the overwhelmingly common same-host case on
 * the mere possibility of a leak this function has no evidence for.
 * @param result - The non-redirect-edge scrape outcome.
 * @param url - The originally-requested URL.
 * @returns `true` when the browser is known to have ended up off-host.
 * @example
 * const wentOffHost = resolveResultWentOffHost(result, url);
 * if (!wentOffHost) {
 *   handleResources(result.resources, parentSource);
 * }
 */
export function resolveResultWentOffHost(
	result: BrowserScrapeResult,
	url: ExURL,
): boolean {
	if (result.pageData !== undefined) {
		return result.pageData.isExternal;
	}
	return (
		result.postNavigationUrl !== undefined &&
		parseUrl(result.postNavigationUrl)?.hostname !== url.hostname
	);
}
