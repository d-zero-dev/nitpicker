import type { MainContentCustomElementCandidate } from './types.js';
import type { Page as PuppeteerPage } from 'puppeteer';

import { collectCustomElements } from './collect-custom-elements.js';

/**
 * Captures every Web Component (custom element) inside a page's
 * main-content region, in document order.
 *
 * `@d-zero/beholder`'s `MainContentsData` has no `customElements` category
 * (confirmed by reading its `types.ts` / `get-main-contents.ts`), so the
 * crawler runs this one extra `page.evaluate` after `scrapeStart` returns,
 * while the page is still alive — the exact same pattern as
 * {@link ./capture-image-dom-paths.ts}, which fills a different gap in
 * beholder's image metadata for the same reason (beholder does not own
 * this detection and does not need to; nitpicker already owns the live
 * `page` object at this point in the scrape).
 *
 * Returns `undefined` on any evaluation failure (page context died,
 * navigation raced the call) — custom-element capture is best-effort
 * enrichment and a capture failure must not fail the scrape. Callers
 * treat `undefined` as "unknown" (a distinct state from "zero elements
 * found"), matching
 * {@link ../archive/meta/compute-main-contents-denormalized.ts}'s
 * three-value handling of `main_content_custom_element_count`.
 * @param page - The live puppeteer page, after the scrape completed and
 *   before the browser closes.
 * @param mainContentSelector - Optional selector override, forwarded
 *   verbatim to {@link ./collect-custom-elements.ts}.
 * @returns Candidates in document order, or `undefined` when the page
 *   could not be evaluated.
 * @example
 * const result = await scraper.scrapeStart(page, url, options);
 * const customElements = await captureCustomElements(page, options.mainContentSelector);
 */
export async function captureCustomElements(
	page: PuppeteerPage,
	mainContentSelector?: string | null,
): Promise<MainContentCustomElementCandidate[] | undefined> {
	try {
		return await page.evaluate(collectCustomElements, mainContentSelector ?? null);
	} catch {
		return undefined;
	}
}
