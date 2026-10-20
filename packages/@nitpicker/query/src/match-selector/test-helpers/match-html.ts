import type { HtmlMatchOutcome } from '@nitpicker/archive/html-snapshot/types';

import { matchSelectorHtml } from '@nitpicker/archive/html-snapshot/match-selector-html';

import { compileSelector } from '../compile-selector.js';
import { planSelectorMatch } from '../plan-selector-match.js';

/**
 * Runs a selector over markup through the full staged path.
 * @param selector - The selector list.
 * @param html - The stored markup.
 * @returns The match outcome.
 */
export function matchHtml(selector: string, html: string): HtmlMatchOutcome {
	return matchSelectorHtml({
		plan: planSelectorMatch(compileSelector(selector)),
		html,
	});
}
