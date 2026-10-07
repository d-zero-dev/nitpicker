import { RAW_TEXT_ELEMENTS_WITH_SCRIPTING_ENABLED } from './raw-text-elements.js';
import { START_TAG_PATTERNS } from './start-tag-patterns.js';
import { toCaseInsensitivePattern } from './to-case-insensitive-pattern.js';

const { nameEnd, nameCharacters, attributeSkip } = START_TAG_PATTERNS;

const RAW_TEXT_NAMES = [...RAW_TEXT_ELEMENTS_WITH_SCRIPTING_ENABLED]
	.map((name) => toCaseInsensitivePattern(name))
	.join('|');

/**
 * Combines compound start tag sources into the single global regular
 * expression that `runDirectMatch` drives, in the style of a router that
 * folds many routes into one pattern and reads which branch matched.
 *
 * Branches, tried in this order at every `<`:
 * 1. capture group 1 — a comment, CDATA section or declaration opener;
 *    its content is skipped by the caller, never consumed here, so an
 *    unterminated one cannot make the engine rescan to the end.
 * 2. the compounds — a match is the answer.
 * 3. capture group 2 — the start tag of a raw text element that the
 *    compounds did not match; the caller skips its content.
 * 4. capture group 3 — a `<template` start tag, which hands the document
 *    to the open-element stack.
 * 5. capture group 4 — any other start tag, consumed whole. Without this a
 *    `<` inside a quoted attribute value (older serializers do not escape
 *    it) would be read as the start of a tag.
 *
 * The compound branches come before the raw text branch so that the
 * raw text element itself can still be matched (`script[src]`).
 * @param compoundSources - Sources from `buildCompoundRegExpSource`.
 * @returns A global regular expression.
 * @example
 * buildDirectRegExp([buildCompoundRegExpSource(compound)!]);
 */
export function buildDirectRegExp(compoundSources: readonly string[]): RegExp {
	const compounds = compoundSources.map((source) => `(?:${source})`).join('|');
	return new RegExp(
		[
			String.raw`(<!--|<!\[CDATA\[|<!)`,
			compounds,
			`<(${RAW_TEXT_NAMES})${nameEnd}${attributeSkip}*>`,
			`(<${toCaseInsensitivePattern('template')}${nameEnd})`,
			`(<[A-Za-z]${nameCharacters}*${attributeSkip}*>)`,
		].join('|'),
		'g',
	);
}
