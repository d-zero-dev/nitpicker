import type { HtmlMatchOutcome } from '../types.js';

import { compileSelector } from '../compile-selector.js';
import { htmlMatchesSelector } from '../html-matches-selector.js';
import { planSelectorMatch } from '../plan-selector-match.js';

/**
 * Runs a selector over markup through the full layered path.
 * @param selector - The selector list.
 * @param html - The stored markup.
 * @returns The match outcome.
 */
export function matchHtml(selector: string, html: string): HtmlMatchOutcome {
	return htmlMatchesSelector({
		plan: planSelectorMatch(compileSelector(selector)),
		html,
	});
}
