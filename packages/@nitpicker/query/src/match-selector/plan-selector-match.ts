import type {
	CompiledSelector,
	NegatedCompound,
	PlannedAlternative,
	SelectorMatchPlan,
} from './types.js';

import { buildCompoundRegExpSource } from './build-compound-regexp-source.js';
import { buildDirectRegExp } from './build-direct-regexp.js';
import { derivePrefilterLiterals } from './derive-prefilter-literals.js';

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
 * Splits a compiled selector list across the matching stages.
 *
 * An alternative that is one compound decidable from a single start tag
 * goes into the combined regular expression (decided without tracking
 * any structure). Everything else — combinators, sibling-position
 * pseudo-classes, values with no single stored form — needs the
 * open-element stack. Every alternative carries the literals its
 * prefilter checks first, so a document that cannot match is rejected
 * without being scanned.
 * @param compiled - The validated selector list.
 * @returns The plan used for every document.
 * @example
 * const plan = planSelectorMatch(compileSelector('img[alt], nav a'));
 */
export function planSelectorMatch(compiled: CompiledSelector): SelectorMatchPlan {
	const allAlternatives: PlannedAlternative[] = [];
	const tokenizedAlternatives: PlannedAlternative[] = [];
	const directSources: string[] = [];
	const directPrefilterLiterals: (readonly string[] | null)[] = [];
	let needsChildIndex = false;
	let needsTypeIndex = false;

	for (const selector of compiled.alternatives) {
		const planned: PlannedAlternative = {
			selector,
			prefilterLiterals: derivePrefilterLiterals(selector),
		};
		allAlternatives.push(planned);
		for (const compound of selector.compounds) {
			for (const part of [compound, ...compound.negations]) {
				needsChildIndex ||= usesNth(part, 'child');
				needsTypeIndex ||= usesNth(part, 'of-type');
			}
		}
		const source =
			selector.compounds.length === 1
				? buildCompoundRegExpSource(selector.compounds[0]!)
				: null;
		if (source === null) {
			tokenizedAlternatives.push(planned);
		} else {
			directSources.push(source);
			directPrefilterLiterals.push(planned.prefilterLiterals);
		}
	}

	return {
		directRegExp: directSources.length > 0 ? buildDirectRegExp(directSources) : null,
		directPrefilterLiterals,
		tokenizedAlternatives,
		allAlternatives,
		needsChildIndex,
		needsTypeIndex,
	};
}
