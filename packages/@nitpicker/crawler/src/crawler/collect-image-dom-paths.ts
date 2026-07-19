import type { DomPathCandidate } from '../archive/populate-entity-tables/types.js';

/**
 * Collects every `<img>` in a document — its `outerHTML` and its
 * `dom_path` string — in document order.
 *
 * **Self-contained by contract.** This function is passed verbatim to
 * puppeteer's `page.evaluate`, which serialises the function source and
 * executes it inside the browser: it must not reference imports,
 * module-scope bindings, or any closure state. That constraint is also
 * what makes single-sourcing possible — the exact same function body
 * runs in the browser during a live crawl AND in Node (against a jsdom
 * document) in its spec, so the dom-path derivation cannot drift between
 * the two runtimes. The spec additionally pins its output against
 * {@link ../archive/populate-entity-tables/derive-dom-path.ts} (the
 * Node-side derivation the migration script uses) element-for-element.
 * @param doc - The document to walk. Defaults to the global `document`,
 *   which is how the in-browser `page.evaluate(collectImageDomPaths)`
 *   call resolves it; Node callers (specs) pass a jsdom document.
 * @returns Candidates in document order.
 * @example
 * const candidates = await page.evaluate(collectImageDomPaths);
 */
export function collectImageDomPaths(doc?: Document): DomPathCandidate[] {
	const target = doc ?? document;
	/**
	 * Counts earlier same-tag siblings, returning the 1-based ordinal.
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

	return Array.from(target.querySelectorAll('img'), (img) => ({
		outerHTML: img.outerHTML,
		path: deriveDomPath(img),
	}));
}
