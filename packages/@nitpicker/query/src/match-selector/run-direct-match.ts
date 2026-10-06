import type { DirectMatchOutcome } from './types.js';

import { findRawTextElementEnd } from './find-raw-text-element-end.js';
import { skipMarkupDeclaration } from './skip-markup-declaration.js';

/**
 * Scans a document with the regular expression from `buildDirectRegExp`
 * and decides, from start tags alone, whether an element matches.
 *
 * A match is exact only if everything before it lies outside a
 * `<template>` — and the scan reads left to right, so the first
 * `<template` stops it with `'needs-tokenizer'` (nested templates cannot
 * be counted by a regular expression). Comments, CDATA sections and the
 * content of raw text elements are skipped so a tag-like string inside
 * them is never read as markup.
 * @param regExp - The global expression to run; its `lastIndex` is reset.
 * @param html - The stored markup.
 * @returns `'matched'`, `'unmatched'` (the whole document was read), or
 *   `'needs-tokenizer'` when the decision needs the open-element stack.
 * @example
 * runDirectMatch(buildDirectRegExp(sources), '<p><img></p>');
 */
export function runDirectMatch(regExp: RegExp, html: string): DirectMatchOutcome {
	regExp.lastIndex = 0;
	for (;;) {
		const match = regExp.exec(html);
		if (!match) {
			return 'unmatched';
		}
		const [, declaration, rawTextName, template, skippedTag] = match;
		if (declaration !== undefined) {
			regExp.lastIndex = skipMarkupDeclaration({
				html,
				opener: declaration,
				from: regExp.lastIndex,
			});
		} else if (rawTextName !== undefined) {
			regExp.lastIndex = findRawTextElementEnd({
				html,
				name: rawTextName.toLowerCase(),
				from: regExp.lastIndex,
			});
		} else if (template !== undefined) {
			return 'needs-tokenizer';
		} else if (skippedTag === undefined) {
			return 'matched';
		}
	}
}
