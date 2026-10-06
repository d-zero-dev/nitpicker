import type { ElementContext, NegatedCompound } from './types.js';

import { matchesAttributeTest } from './matches-attribute-test.js';
import { matchesNth } from './matches-nth.js';
import { parseStartTagAttributes } from './parse-start-tag-attributes.js';

/**
 * Tests one compound selector against one element. Cheap tests run first
 * (tag, sibling position) and the start tag's attributes are parsed only
 * when a test needs them, then cached on the element context.
 * @param compound - The compound (or the compound inside `:not()`).
 * @param element - The element under test.
 * @returns `true` when every condition holds.
 * @example
 * matchesCompound(
 *   { tag: 'a', attributes: [], nth: [], negations: [] },
 *   { name: 'a', attrSource: '', attributes: null, childIndex: 1, typeIndex: 1 },
 * ); // true
 */
export function matchesCompound(
	compound: NegatedCompound & { readonly negations?: readonly NegatedCompound[] },
	element: ElementContext,
): boolean {
	if (compound.tag !== null && compound.tag !== element.name) {
		return false;
	}
	for (const nth of compound.nth) {
		const position = nth.kind === 'child' ? element.childIndex : element.typeIndex;
		if (!matchesNth(position, nth.a, nth.b)) {
			return false;
		}
	}
	if (compound.attributes.length > 0) {
		element.attributes ??= parseStartTagAttributes(element.attrSource);
		for (const test of compound.attributes) {
			if (!matchesAttributeTest(test, element.attributes)) {
				return false;
			}
		}
	}
	if (compound.negations) {
		for (const negation of compound.negations) {
			if (matchesCompound(negation, element)) {
				return false;
			}
		}
	}
	return true;
}
