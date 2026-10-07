import type { TagEvent } from './types.js';

import { findRawTextElementEnd } from './find-raw-text-element-end.js';
import { RAW_TEXT_ELEMENTS_WITH_SCRIPTING_ENABLED } from './raw-text-elements.js';
import { skipMarkupDeclaration } from './skip-markup-declaration.js';
import { START_TAG_PATTERNS } from './start-tag-patterns.js';
import { VOID_ELEMENTS } from './void-elements.js';

const { nameCharacters, attributeSkip } = START_TAG_PATTERNS;

const TAG_PATTERN_SOURCE = [
	String.raw`(<!--|<!\[CDATA\[|<!)`,
	String.raw`<\/([A-Za-z]${nameCharacters}*)[^>]*>`,
	`<([A-Za-z]${nameCharacters}*)(${attributeSkip}*)>`,
].join('|');

/**
 * Creates a reader that jumps from tag to tag through stored markup with
 * one global regular expression, never looking at text in between.
 *
 * Comments, CDATA sections and declarations are skipped. A raw text
 * element is returned as a childless open event and its content and end
 * tag are consumed, so tag-like text inside it is never read as markup
 * and no close event follows. Void elements and `<x/>` are childless too.
 * Attribute text is returned unparsed.
 * @param html - The stored markup.
 * @returns An object whose `next()` returns the following tag event, or
 *   `null` at the end of the document.
 * @example
 * const tokenizer = createHtmlTagTokenizer('<p class="a">x</p>');
 * tokenizer.next(); // { kind: 'open', name: 'p', attrSource: ' class="a"', leaf: false }
 */
export function createHtmlTagTokenizer(html: string): { next(): TagEvent | null } {
	const pattern = new RegExp(TAG_PATTERN_SOURCE, 'g');
	// A global expression restarts from 0 after a failed `exec`, so the end is remembered.
	let finished = false;
	return {
		next(): TagEvent | null {
			for (;;) {
				const match = finished ? null : pattern.exec(html);
				if (!match) {
					finished = true;
					return null;
				}
				const [, declaration, closeName, openName, attrSource] = match;
				if (declaration !== undefined) {
					pattern.lastIndex = skipMarkupDeclaration({
						html,
						opener: declaration,
						from: pattern.lastIndex,
					});
					continue;
				}
				if (closeName !== undefined) {
					return { kind: 'close', name: closeName.toLowerCase() };
				}
				const name = openName!.toLowerCase();
				if (RAW_TEXT_ELEMENTS_WITH_SCRIPTING_ENABLED.has(name)) {
					pattern.lastIndex = findRawTextElementEnd({
						html,
						name,
						from: pattern.lastIndex,
					});
					return { kind: 'open', name, attrSource: attrSource!, leaf: true };
				}
				return {
					kind: 'open',
					name,
					attrSource: attrSource!,
					leaf: VOID_ELEMENTS.has(name) || attrSource!.endsWith('/'),
				};
			}
		},
	};
}
