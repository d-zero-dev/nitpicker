/**
 * Wraps a parse5 element node so it satisfies the minimal DOM `Element`
 * shape (`tagName` / `parentElement` / `previousElementSibling`) that
 * `deriveDomPath` (`@nitpicker/crawler`) is written against. parse5's
 * plain-object AST has `parentNode` / `childNodes` instead — this
 * adapter is the only place that difference is bridged, so
 * `deriveDomPath` itself stays parser-agnostic (jsdom `Element`, this
 * adapter, or a future puppeteer handle all satisfy the same shape).
 * @example
 * const document = parse5.parse(html);
 * const [img] = findElementsByTagName(document, 'img');
 * deriveDomPath(new Parse5ElementAdapter(img));
 */
export class Parse5ElementAdapter {
	#node;

	/** Lower-cased tag name (parse5 already lower-cases HTML tag names during tokenization). */
	get tagName() {
		return this.#node.tagName;
	}
	/** The wrapped parent element, or `null` at the document root. */
	get parentElement() {
		const parent = this.#node.parentNode;
		if (parent === null || !('tagName' in parent)) {
			return null;
		}
		return new Parse5ElementAdapter(parent);
	}
	/** The wrapped previous element sibling, skipping text/comment nodes, or `null`. */
	get previousElementSibling() {
		const parent = this.#node.parentNode;
		if (parent === null) {
			return null;
		}
		const index = parent.childNodes.indexOf(this.#node);
		for (let i = index - 1; i >= 0; i--) {
			const sibling = parent.childNodes[i];
			if ('tagName' in sibling) {
				return new Parse5ElementAdapter(sibling);
			}
		}
		return null;
	}
	/** @param {import('parse5').DefaultTreeAdapterMap['element']} node */
	constructor(node) {
		this.#node = node;
	}
}
