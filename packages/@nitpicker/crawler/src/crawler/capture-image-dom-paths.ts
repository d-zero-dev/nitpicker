import type { DomPathCandidate } from '../archive/populate-entity-tables/types.js';
import type { Page as PuppeteerPage } from 'puppeteer';

import { collectImageDomPaths } from './collect-image-dom-paths.js';

/**
 * Captures every `<img>` in the rendered document — its `outerHTML` and
 * its `dom_path` string — in document order, for `image_items.dom_path_text_id`
 * resolution at write time.
 *
 * `@d-zero/beholder`'s image metadata carries the element's `outerHTML`
 * (`sourceCode`) but no positional information, so the crawler runs this
 * one extra `page.evaluate` after `scrapeStart` returns, while the page
 * is still alive. The in-browser walk is
 * {@link ./collect-image-dom-paths.ts} — a self-contained function whose
 * source puppeteer serialises into the page, and whose spec pins its
 * output against the Node-side
 * {@link ../archive/populate-entity-tables/derive-dom-path.ts} so a
 * live-crawled archive and one whose dom paths were reconstructed from
 * HTML snapshots by the migration script produce identical strings for
 * identical DOM shapes.
 *
 * Returns `undefined` on any evaluation failure (page context died,
 * navigation raced the call) — dom paths are best-effort enrichment and
 * a capture failure must not fail the scrape. Callers fall back to the
 * `unknown/<id>` synthetic marker per image via
 * {@link ../archive/populate-entity-tables/match-images-to-dom-paths.ts}.
 * @param page - The live puppeteer page, after the scrape completed and
 *   before the browser closes.
 * @returns Candidates in document order, or `undefined` when the page
 *   could not be evaluated.
 * @example
 * const result = await scraper.scrapeStart(page, url, options);
 * const imageDomPaths = await captureImageDomPaths(page);
 */
export async function captureImageDomPaths(
	page: PuppeteerPage,
): Promise<DomPathCandidate[] | undefined> {
	try {
		return await page.evaluate(collectImageDomPaths);
	} catch {
		return undefined;
	}
}
