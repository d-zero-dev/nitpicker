/**
 * Computes the `dom_path` string for one DOM element as required by
 * `image_items.dom_path_text_id` (issue #193 step 6-D-6).
 *
 * Format: slash-joined ancestor tags starting at `<html>`, each tag
 * followed by a 1-based sibling ordinal counting **same-tag** siblings
 * only (identical to the spec's example
 * `html/body[1]/main[1]/section[2]/picture[1]/img[1]`). The `<html>`
 * root has no bracketed ordinal because there is only one document
 * root per page.
 *
 * The walk uses `parentElement` + `previousElementSibling` — no
 * document mutation, no reliance on `id` / `class` — so a re-render
 * that only reshuffles class names or ids still produces the same path.
 * The chain of tag names alone is stable for a given DOM shape.
 *
 * The function operates on the generic `Element` interface from DOM lib
 * (available in the crawler's TS lib config) so it does not force
 * jsdom into the crawler runtime — the migration script and unit tests
 * inject jsdom-backed elements, while a future crawler-side wrapper
 * (Phase 6-G) can pass puppeteer's DOM handles through the same code.
 *
 * Detached elements (`element.parentElement === null` before reaching
 * `<html>`) return the tag chain from wherever the walk terminates.
 * This matches the plan's "walk the DOM ancestor chain from the
 * `<img>` element to `<html>`" — a legally detached image (rare, but
 * technically possible during scripted mutations) yields e.g.
 * `img[1]` alone instead of throwing.
 * @param element - The DOM element to derive the path for. Typically an
 *   `<img>` in the archived HTML, but the function is not tag-specific.
 * @returns The dom_path string.
 * @example
 * // In an HTML snapshot `<html><body><main><img></main></body></html>`
 * deriveDomPath(imgElement); // 'html/body[1]/main[1]/img[1]'
 */
export function deriveDomPath(element: Element): string {
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

/**
 * Counts how many earlier siblings share the same tag name as `element`,
 * returning `count + 1` as the 1-based ordinal.
 *
 * Iterating `previousElementSibling` is O(k) where k is the sibling
 * position; for typical DOM depth and sibling counts this is negligible
 * next to the jsdom parse cost of the enclosing page.
 * @param element - The element whose ordinal is being computed.
 * @param tag - The lower-cased tag name to match on. Passed in by the
 *   caller so `element.tagName.toLowerCase()` is not recomputed inside
 *   the loop for every sibling comparison.
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
