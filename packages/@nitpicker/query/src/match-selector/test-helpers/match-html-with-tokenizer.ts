import type { HtmlMatchOutcome } from '@nitpicker/archive/html-snapshot/types';

import { matchSelectorHtml } from '@nitpicker/archive/html-snapshot/match-selector-html';

import { compileSelector } from '../compile-selector.js';
import { planSelectorMatch } from '../plan-selector-match.js';

/**
 * Runs a selector over markup with every alternative forced onto the
 * open-element stack (no start-tag-only read), so the two exact stages can
 * be compared on the same input.
 * @param selector - The selector list.
 * @param html - The stored markup.
 * @returns The match outcome.
 */
export function matchHtmlWithTokenizer(selector: string, html: string): HtmlMatchOutcome {
	const plan = planSelectorMatch(compileSelector(selector));
	return matchSelectorHtml({
		plan: {
			...plan,
			alternatives: plan.alternatives.map((alternative) => ({
				...alternative,
				direct: false,
			})),
		},
		html,
	});
}
