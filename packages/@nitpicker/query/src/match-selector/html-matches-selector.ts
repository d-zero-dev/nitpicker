import type { DirectMatchOutcome, HtmlMatchOutcome, SelectorMatchPlan } from './types.js';

import { passesOrderedPrefilter } from './passes-ordered-prefilter.js';
import { runDirectMatch } from './run-direct-match.js';
import { runSelectorStateMachine } from './run-selector-state-machine.js';

/**
 * Decides whether any element of a stored document matches a planned
 * selector list, using the cheapest layer that is exact.
 *
 * 1. Every alternative first passes the ordered-literal prefilter, which
 *    can only reject a document that cannot match it. A document that
 *    lacks the literals of every alternative is rejected without being
 *    scanned.
 * 2. Alternatives that are a single compound are decided by one regular
 *    expression scan; a match ends the call. If the scan reaches a
 *    `<template>` it stops and every surviving alternative goes to the
 *    next layer.
 * 3. The rest run on the open-element stack.
 *
 * The result is a judgement about the stored string, read as markup with
 * balanced tags (see `docs/query.md` for the interpretation rules); it is
 * not guaranteed to equal the verdict on the DOM the string was
 * serialized from, because serialization is not injective.
 * @param options - The plan and the document.
 * @param options.plan - The plan from `planSelectorMatch`.
 * @param options.html - The stored markup.
 * @returns The verdict and which layers ran.
 * @example
 * htmlMatchesSelector({ plan: planSelectorMatch(compileSelector('img[alt]')), html }).matched;
 */
export function htmlMatchesSelector(options: {
	readonly plan: SelectorMatchPlan;
	readonly html: string;
}): HtmlMatchOutcome {
	const { plan, html } = options;
	let lowerCased: string | null = null;
	/** Lower-cased once per document, and only if a prefilter needs it. */
	const lowered = () => (lowerCased ??= html.toLowerCase());
	const passes = (literals: readonly string[] | null) =>
		literals === null || passesOrderedPrefilter(lowered(), literals);

	let direct: DirectMatchOutcome | 'skipped' = 'skipped';
	if (plan.directRegExp !== null && plan.directPrefilterLiterals.some((l) => passes(l))) {
		direct = runDirectMatch(plan.directRegExp, html);
		if (direct === 'matched') {
			return { matched: true, prefiltered: false, tokenized: false, elementsVisited: 0 };
		}
	}

	const candidates =
		direct === 'needs-tokenizer' ? plan.allAlternatives : plan.tokenizedAlternatives;
	const survivors = candidates.filter((c) => passes(c.prefilterLiterals));
	if (survivors.length === 0) {
		// Rejected by literals alone only when no scan of the markup took place.
		const scanned = direct === 'unmatched' || direct === 'needs-tokenizer';
		return {
			matched: false,
			prefiltered: !scanned,
			tokenized: false,
			elementsVisited: 0,
		};
	}

	const { matched, elementsVisited } = runSelectorStateMachine({
		alternatives: survivors,
		needsChildIndex: plan.needsChildIndex,
		needsTypeIndex: plan.needsTypeIndex,
		html,
	});
	return { matched, prefiltered: false, tokenized: true, elementsVisited };
}
