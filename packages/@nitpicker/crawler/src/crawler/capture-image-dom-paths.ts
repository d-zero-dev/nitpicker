import type { DomPathCandidate } from '../archive/populate-entity-tables/types.js';
import type { Page as PuppeteerPage } from 'puppeteer';

/**
 * Captures every `<img>` in the rendered document — its `outerHTML` and
 * its `dom_path` string — in document order, for `image_items.dom_path_text_id`
 * resolution at write time.
 *
 * `@d-zero/beholder`'s image metadata carries the element's `outerHTML`
 * (`sourceCode`) but no positional information, so the crawler runs this
 * one extra `page.evaluate` after `scrapeStart` returns, while the page
 * is still alive. The in-browser walk mirrors
 * {@link ../archive/populate-entity-tables/derive-dom-path.ts} exactly
 * (slash-joined ancestor tags from `<html>`, 1-based same-tag sibling
 * ordinals, no ordinal on the root) so a live-crawled archive and one
 * whose dom paths were reconstructed from HTML snapshots by the
 * migration script produce identical strings for identical DOM shapes.
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
		return await page.evaluate(() => {
			/**
			 * Counts earlier same-tag siblings, returning the 1-based ordinal.
			 * In-browser mirror of the archive-side dom-path derivation.
			 * @param element - The element whose ordinal is being computed.
			 * @param tag - The element's lower-cased tag name.
			 * @returns 1-based ordinal among same-tag siblings.
			 */
			function computeSiblingOrdinal(element: Element, tag: string): number {
				let count = 1;
				let sibling: Element | null = element.previousElementSibling;
				while (sibling !== null) {
					if (sibling.tagName.toLowerCase() === tag) {
						count += 1;
					}
					sibling = sibling.previousElementSibling;
				}
				return count;
			}
			/**
			 * Derives the slash-joined dom_path for one element.
			 * @param element - The element to derive the path for.
			 * @returns The dom_path string.
			 */
			function deriveDomPath(element: Element): string {
				const segments: string[] = [];
				let current: Element | null = element;
				while (current !== null) {
					const tag = current.tagName.toLowerCase();
					if (tag === 'html') {
						segments.unshift('html');
						break;
					}
					segments.unshift(`${tag}[${computeSiblingOrdinal(current, tag)}]`);
					current = current.parentElement;
				}
				return segments.join('/');
			}

			return Array.from(document.querySelectorAll('img'), (img) => ({
				outerHTML: img.outerHTML,
				path: deriveDomPath(img),
			}));
		});
	} catch {
		return undefined;
	}
}
