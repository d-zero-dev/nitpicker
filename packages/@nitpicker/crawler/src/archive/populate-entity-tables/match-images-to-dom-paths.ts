import type { DomPathResult } from './types.js';

import { deriveDomPath } from './derive-dom-path.js';

/**
 * One legacy `images` row projected onto the fields the matcher needs.
 * Restricted to `id` (used to build the returned Map) and `sourceCode`
 * (the outerHTML string to match against DOM candidates).
 */
interface ImageRowForMatching {
	/** Legacy `images.id`. */
	id: number;
	/**
	 * Legacy `images.sourceCode` — the `<img>` element's `outerHTML` as
	 * stored by the crawler. `null` when the crawler failed to capture
	 * the source (a null blob or a puppeteer serialisation edge case).
	 */
	sourceCode: string | null;
}

/**
 * Matches a page's legacy `images` rows to their DOM-path strings using
 * a 3-case algorithm (issue #193).
 *
 * The three cases:
 *
 * 1. **Single match** — `image.sourceCode` matches exactly one `<img>`
 *    outerHTML in the document. Assign that element's `dom_path`.
 * 2. **Ordinal match** — multiple `<img>` elements share the same
 *    outerHTML (identical `src` / `alt` / attributes on the same page).
 *    Assign paths in `images.id` order, matching the crawler's
 *    insertion order which is expected to correspond to DOM order.
 * 3. **Unknown** — `sourceCode` is null OR no matching `<img>` exists
 *    in the document (crawler-side rewriting drift). Fall back to the
 *    synthetic `unknown/<id>` marker so the `dom_path_text_id NOT NULL`
 *    constraint is still satisfied.
 *
 * The function is pure and does not touch the DB. Callers pre-parse the
 * page's HTML with jsdom (or any DOM implementation), pass the resulting
 * `<img>` NodeList / array plus the `images` rows filtered to that page,
 * and receive one `DomPathResult` per input row.
 *
 * `imgElementsInDocumentOrder` MUST already be in document order — the
 * matcher does not sort. jsdom's `document.querySelectorAll('img')`
 * satisfies this contract; ordering after the call is the caller's
 * responsibility.
 *
 * `images` MUST already be sorted by `id` ascending for the ordinal-
 * match case to reproduce the crawler's insertion order deterministically.
 * A minor deviation from this ordering only affects the ordinal-match
 * branch — single-match and unknown branches are order-independent.
 * @param images - The page's `images` rows in `id` order.
 * @param imgElementsInDocumentOrder - `<img>` elements from the parsed
 *   HTML, in document order.
 * @returns Map keyed by `images.id`; every input row gets one entry.
 * @example
 * const jsdom = new JSDOM(html);
 * const imgs = [...jsdom.window.document.querySelectorAll('img')];
 * const result = matchImagesToDomPaths(
 *   [{ id: 1, sourceCode: '<img src="a.png">' }],
 *   imgs,
 * );
 * result.get(1); // { path: 'html/body[1]/img[1]', case: 'single-match' }
 */
export function matchImagesToDomPaths(
	images: readonly ImageRowForMatching[],
	imgElementsInDocumentOrder: readonly Element[],
): ReadonlyMap<number, DomPathResult> {
	const byOuterHtml = new Map<string, Element[]>();
	const domPathByElement = new WeakMap<Element, string>();
	for (const img of imgElementsInDocumentOrder) {
		const outerHtml = img.outerHTML;
		const bucket = byOuterHtml.get(outerHtml);
		if (bucket === undefined) {
			byOuterHtml.set(outerHtml, [img]);
		} else {
			bucket.push(img);
		}
	}

	const cursorByOuterHtml = new Map<string, number>();
	const result = new Map<number, DomPathResult>();
	for (const image of images) {
		if (image.sourceCode === null || image.sourceCode === '') {
			result.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
			continue;
		}
		const candidates = byOuterHtml.get(image.sourceCode);
		if (candidates === undefined || candidates.length === 0) {
			result.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
			continue;
		}
		if (candidates.length === 1) {
			result.set(image.id, {
				path: getOrDeriveDomPath(candidates[0]!, domPathByElement),
				case: 'single-match',
			});
			continue;
		}
		const cursor = cursorByOuterHtml.get(image.sourceCode) ?? 0;
		cursorByOuterHtml.set(image.sourceCode, cursor + 1);
		const chosen = candidates[cursor];
		if (chosen === undefined) {
			// More `images` rows share this outerHTML than the archived HTML
			// has matching `<img>` elements — the earlier fallback
			// (`candidates.at(-1)`) silently mapped every overflow row to
			// the last matched element, producing multiple `image_items`
			// rows with the same `dom_path_text_id`. Falling back to
			// `unknown/<id>` keeps overflow rows individually
			// distinguishable in the archive.
			result.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
			continue;
		}
		result.set(image.id, {
			path: getOrDeriveDomPath(chosen, domPathByElement),
			case: 'ordinal-match',
		});
	}
	return result;
}

/**
 * Caches {@link deriveDomPath} results against `element` identity. Duplicate
 * `<img>` outerHTML values in the same document can point the ordinal
 * cursor at the same element more than once (when the ordinal exceeds
 * the candidate list length — a defensive fallback via `candidates.at(-1)`);
 * caching keeps the DOM walk cost O(unique elements) rather than
 * O(matches).
 * @param element - The DOM element to derive against.
 * @param cache - The memo cache used across one page's match pass.
 * @returns Derived `dom_path` string.
 */
function getOrDeriveDomPath(element: Element, cache: WeakMap<Element, string>): string {
	const cached = cache.get(element);
	if (cached !== undefined) {
		return cached;
	}
	const path = deriveDomPath(element);
	cache.set(element, path);
	return path;
}
