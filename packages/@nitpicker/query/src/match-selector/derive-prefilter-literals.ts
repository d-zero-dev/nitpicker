import type { AttributeTest, ComplexSelector } from './types.js';

const ESCAPABLE = /["&'<>]/;

/**
 * Whether every character is printable ASCII. A non-ASCII letter can fold
 * differently by position (a final sigma), so it never goes into a
 * lower-cased literal.
 * @param text - The text to check.
 * @returns `true` when all characters are U+0020 to U+007E.
 */
function isPrintableAscii(text: string): boolean {
	for (const character of text) {
		const code = character.codePointAt(0)!;
		if (code < 32 || code > 126) {
			return false;
		}
	}
	return true;
}

/**
 * Whether a string can serve as a prefilter literal: non-empty printable
 * ASCII without the characters serialization may escape, so it appears
 * verbatim in the stored markup whenever the element carries it.
 * @param literal - The candidate.
 * @returns `true` when it is safe to look for.
 */
function isUsableLiteral(literal: string): boolean {
	return literal !== '' && isPrintableAscii(literal) && !ESCAPABLE.test(literal);
}

/**
 * The literal one attribute test requires in the markup: its name for an
 * existence test, its value otherwise.
 * @param test - The attribute condition.
 * @returns The literal, or `null` when none is usable.
 */
function literalOfAttribute(test: AttributeTest): string | null {
	if (test.operator === 'exists') {
		return isUsableLiteral(test.name) ? test.name : null;
	}
	return isUsableLiteral(test.value) && !/\s/.test(test.value) ? test.value : null;
}

/**
 * Picks, per compound of a selector, one literal that must appear in the
 * document for the compound to match: an id, a class token, an attribute
 * value, the `<tag` opener, or an attribute name, in that order of
 * selectivity. Conditions inside `:not()` contribute nothing.
 *
 * Only printable ASCII free of `" & ' < >` is used: such a literal is
 * stored verbatim whatever the escaping, and ASCII lower-casing it is
 * consistent with lower-casing the document (non-ASCII letters can fold
 * differently by position).
 * @param selector - One comma alternative.
 * @returns Lower-cased literals in ancestor-first order, or `null` when
 *   no compound yields one.
 * @example
 * derivePrefilterLiterals(compiled.alternatives[0]!); // e.g. ['<nav', 'menu', '<a']
 */
export function derivePrefilterLiterals(selector: ComplexSelector): string[] | null {
	const literals: string[] = [];
	for (const compound of selector.compounds) {
		const id = compound.attributes.find(
			(a) => a.name === 'id' && a.operator === 'equals',
		);
		const className = compound.attributes.find(
			(a) => a.name === 'class' && a.operator === 'includes',
		);
		const valued = compound.attributes.find(
			(a) => a.operator !== 'exists' && literalOfAttribute(a) !== null,
		);
		// Whatever the operator, the attribute has to be present, so its name is
		// always a necessary literal when it is usable.
		const named = compound.attributes.find((a) => isUsableLiteral(a.name));
		const candidates = [
			id && literalOfAttribute(id),
			className && literalOfAttribute(className),
			valued && literalOfAttribute(valued),
			compound.tag !== null && isUsableLiteral(compound.tag) ? `<${compound.tag}` : null,
			named?.name,
		];
		const chosen = candidates.find(Boolean);
		if (chosen) {
			literals.push(chosen.toLowerCase());
		}
	}
	return literals.length > 0 ? literals : null;
}
