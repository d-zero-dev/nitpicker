import type { CompiledSelector, NegatedCompound } from './types.js';
import type { SelectorPlan } from '@nitpicker/archive/html-snapshot/types';

import { derivePrefilterLiterals } from './derive-prefilter-literals.js';
import { isDecidableFromOneStartTag } from './is-decidable-from-one-start-tag.js';

/**
 * Whether a compound tests the given kind of sibling position.
 * @param compound - The compound or the compound inside `:not()`.
 * @param kind - `child` for `:nth-child` / `:first-child`, `of-type` for the `-of-type` forms.
 * @returns `true` when such a test is present.
 */
function usesNth(compound: NegatedCompound, kind: 'child' | 'of-type'): boolean {
	return compound.nth.some((test) => test.kind === kind);
}

/**
 * Turns a validated selector list into the plan the native matcher
 * evaluates.
 *
 * An alternative that one start tag settles (`direct`) is tried by reading
 * start tags alone; everything else — combinators, sibling-position
 * pseudo-classes, values with no single stored form — needs the
 * open-element stack. Every alternative carries the literals its prefilter
 * checks first, so a document that cannot match is rejected without its
 * markup being read.
 * @param compiled - The validated selector list.
 * @returns The plan used for every document.
 * @example
 * const plan = planSelectorMatch(compileSelector('img[alt], nav a'));
 */
export function planSelectorMatch(compiled: CompiledSelector): SelectorPlan {
	let needsChildIndex = false;
	let needsTypeIndex = false;
	const alternatives = compiled.alternatives.map((selector) => {
		for (const compound of selector.compounds) {
			for (const part of [compound, ...compound.negations]) {
				needsChildIndex ||= usesNth(part, 'child');
				needsTypeIndex ||= usesNth(part, 'of-type');
			}
		}
		return {
			compounds: selector.compounds,
			combinators: selector.combinators,
			prefilterLiterals: derivePrefilterLiterals(selector),
			direct: isDecidableFromOneStartTag(selector),
		};
	});
	return { alternatives, needsChildIndex, needsTypeIndex };
}
