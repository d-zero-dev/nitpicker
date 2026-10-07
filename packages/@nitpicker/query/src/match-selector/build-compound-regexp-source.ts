import type { CompoundMatcher, NegatedCompound } from './types.js';

import { buildAttributeLookahead } from './build-attribute-lookahead.js';
import { START_TAG_PATTERNS } from './start-tag-patterns.js';
import { toCaseInsensitivePattern } from './to-case-insensitive-pattern.js';

const { nameCharacters, nameEnd } = START_TAG_PATTERNS;

/**
 * Look-ahead conditions (from the first character of a tag name) that all hold when
 * the start tag satisfies a tag name and attribute conditions.
 * @param compound - The conditions.
 * @returns The concatenated look-ahead conditions, or `null` when an attribute value
 *   cannot be matched against one stored form.
 */
function buildConditions(compound: NegatedCompound): string | null {
	let source = '';
	source +=
		compound.tag === null
			? `(?=[A-Za-z]${nameCharacters}*${nameEnd})`
			: `(?=${toCaseInsensitivePattern(compound.tag)}${nameEnd})`;
	for (const attribute of compound.attributes) {
		const lookahead = buildAttributeLookahead(attribute);
		if (lookahead === null) {
			return null;
		}
		source += `(?=${lookahead})`;
	}
	return source;
}

/**
 * Builds a regular expression source that matches the start tag of an
 * element satisfying `compound`, from the `<` through the first
 * character of the tag name. Every condition is a lookahead from the tag
 * name, so attributes may appear in any order, and `:not()` becomes a
 * negative lookahead over the same conditions.
 *
 * Returns `null` when the compound cannot be decided from one start tag:
 * it uses a sibling-position pseudo-class, or an attribute value contains
 * `<` / `>` (its stored form depends on the browser that serialized it).
 * @param compound - The compound selector.
 * @returns The regular expression source, or `null` when the compound
 *   needs the open-element stack.
 * @example
 * buildCompoundRegExpSource({ tag: 'img', attributes: [], nth: [], negations: [] });
 */
export function buildCompoundRegExpSource(compound: CompoundMatcher): string | null {
	if (compound.nth.length > 0 || compound.negations.some((n) => n.nth.length > 0)) {
		return null;
	}
	const positive = buildConditions(compound);
	if (positive === null) {
		return null;
	}
	let negative = '';
	for (const negation of compound.negations) {
		const conditions = buildConditions(negation);
		if (conditions === null) {
			return null;
		}
		negative += `(?!${conditions})`;
	}
	return `<${positive}${negative}[A-Za-z]`;
}
