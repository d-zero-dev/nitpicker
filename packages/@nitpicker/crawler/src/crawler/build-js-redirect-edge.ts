import type { RedirectEdgeResult } from './types.js';
import type { PageData } from '@d-zero/beholder';
import type { ExURL } from '@d-zero/shared/parse-url';

import { crawlerLog } from '../debug.js';

import { deriveJsRedirectTarget } from './derive-js-redirect-target.js';
import { isJsRedirectErrorShape } from './is-js-redirect-error-shape.js';
import { linkToPageData } from './link-to-page-data.js';

/**
 * Parameters for {@link buildJsRedirectEdge}.
 */
export interface BuildJsRedirectEdgeParams {
	/** Source URL puppeteer was asked to navigate to. */
	url: ExURL;
	/**
	 * Whether `url` is external to the crawl scope. Propagated onto the
	 * synthesised `PageData` so downstream `linkList.done` classifies the
	 * source the same way the original scrape would have.
	 */
	isExternal: boolean;
	/**
	 * Raw error message from `BrowserScrapeResult.error`. The rescue only
	 * fires when this matches the narrow `Page.goto returned null` sentinel
	 * (see {@link isJsRedirectErrorShape}) — anything else falls through
	 * so genuine browser failures surface unchanged.
	 */
	errorMessage: string | null | undefined;
	/**
	 * Value of `BrowserScrapeResult.postNavigationUrl` — the URL puppeteer's
	 * `page.url()` reported after the throw. Passed to
	 * {@link deriveJsRedirectTarget} for canonicalisation, credential strip,
	 * and scheme filtering.
	 */
	postNavigationUrl: string | null | undefined;
	/**
	 * When present, the rescue builds the redirect-edge `PageData` by
	 * spreading this HEAD-pre-flight result and overriding `redirectPaths`.
	 * Use this on the HEAD-success-then-puppeteer-fail path so the source row
	 * carries the real HTTP-level status / content-type from HEAD. When
	 * omitted, the rescue builds a synthetic placeholder via
	 * {@link linkToPageData} with `status = -1` / `statusText = errorMessage`
	 * — used on the HEAD-fail-then-puppeteer-fallback path where there is
	 * no HEAD response to draw from.
	 */
	headCheckResult?: PageData;
}

/**
 * Build a JS-redirect `RedirectEdgeResult` when the browser-scrape error
 * looks like puppeteer's `page.goto() === null` shape AND `page.url()`
 * resolved to a meaningfully-different URL.
 *
 * **Why this helper exists** — both rescue call sites in
 * `Crawler.#scrapePage` (the HEAD-success-then-puppeteer-fail tail and the
 * HEAD-fail-then-puppeteer-fallback branch inside `#sendHeadRequest`) run
 * the same three-step recipe: classify the error shape → derive a JS target
 * from `page.url()` → synthesise a redirect-edge result. Inlining the recipe
 * twice means a future change to `deriveJsRedirectTarget`'s contract or the
 * sentinel string has to be applied to both copies in sync; collapsing into
 * a single helper keeps the rescue's invariants in one place. The
 * intentional difference between the two call sites (whether to fold a
 * HEAD result into the synthesised PageData or to start from a
 * `linkToPageData` placeholder) is reduced to a single optional parameter
 * (`headCheckResult`), preserving both shapes without behavioural drift.
 *
 * The helper logs at `crawlerLog` whenever it fires so operators tailing
 * `DEBUG=Nitpicker:Crawler` see exactly which URL got rescued and to which
 * destination — without this trail the rescue is invisible to anyone
 * debugging "why did this 200-OK source row land in the archive as a 301?".
 * @param params - Inputs gathered at the call site.
 * @returns A `RedirectEdgeResult` when the rescue applies, otherwise
 *   `null` (the caller should fall through to the existing error path).
 */
export function buildJsRedirectEdge(
	params: BuildJsRedirectEdgeParams,
): RedirectEdgeResult | null {
	if (!isJsRedirectErrorShape(params.errorMessage)) {
		return null;
	}
	const jsRedirectTarget = deriveJsRedirectTarget(
		params.url.withoutHashAndAuth,
		params.postNavigationUrl,
	);
	if (jsRedirectTarget === null) {
		return null;
	}
	const pageData: PageData = params.headCheckResult
		? { ...params.headCheckResult, redirectPaths: [jsRedirectTarget] }
		: linkToPageData({
				url: params.url,
				isExternal: params.isExternal,
				isLowerLayer: false,
				dest: {
					redirectPaths: [jsRedirectTarget],
					status: -1,
					statusText: typeof params.errorMessage === 'string' ? params.errorMessage : '',
					contentType: null,
					contentLength: null,
					responseHeaders: null,
					title: '',
				},
			});
	crawlerLog(
		'JS-redirect rescue fired for %s → %s (HEAD %s)',
		params.url.href,
		jsRedirectTarget,
		params.headCheckResult ? 'available' : 'absent',
	);
	return { type: 'redirect-edge', source: 'js-redirect', pageData };
}
