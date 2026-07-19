/**
 * Walks a parse5 tree depth-first and returns every element node whose
 * `tagName` matches, in document order — the parse5 equivalent of
 * `document.querySelectorAll(tagName)` for a single tag.
 * @param {import('parse5').DefaultTreeAdapterMap['parentNode']} root - A
 *   parse5 `Document`/`Element`/`DocumentFragment` node to search under.
 * @param {string} tagName - Lower-cased tag name to match (parse5
 *   already lower-cases HTML tag names during tokenization).
 * @returns {import('parse5').DefaultTreeAdapterMap['element'][]}
 * @example
 * const document = parse5.parse(html);
 * const images = findElementsByTagName(document, 'img');
 */
export function findElementsByTagName(root, tagName) {
	const matches = [];
	const stack = (root.childNodes ?? []).toReversed();
	while (stack.length > 0) {
		const node = stack.pop();
		if (!('tagName' in node)) {
			continue;
		}
		if (node.tagName === tagName) {
			matches.push(node);
		}
		if (node.childNodes.length > 0) {
			stack.push(...node.childNodes.toReversed());
		}
	}
	return matches;
}
