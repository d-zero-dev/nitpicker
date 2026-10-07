import type { HtmlMatchOutcome } from '../types.js';

import { compileSelector } from '../compile-selector.js';
import { htmlMatchesSelector } from '../html-matches-selector.js';
import { planSelectorMatch } from '../plan-selector-match.js';

/**
 * Runs a selector over markup with every alternative forced onto the
 * open-element stack (no direct scan, no prefilter bypass), so the two
 * exact stages can be compared on the same input.
 * @param selector - The selector list.
 * @param html - The stored markup.
 * @returns The match outcome.
 */
export function matchHtmlWithTokenizer(selector: string, html: string): HtmlMatchOutcome {
	const plan = planSelectorMatch(compileSelector(selector));
	return htmlMatchesSelector({
		plan: {
			...plan,
			directRegExp: null,
			tokenizedAlternatives: plan.allAlternatives,
		},
		html,
	});
}
