import type { HtmlMatchOutcome, SelectorPlan } from './types.js';

import { matchSelectorHtml as matchSelectorHtmlNatively } from '@nitpicker/core/match-selector-html';

/**
 * Decides whether any element of one stored HTML document matches a planned
 * selector list, using the cheapest stage that is exact: an ordered-literal
 * prefilter, then the start tags alone for selectors one tag decides, then
 * an open-element stack. The matcher itself is native (`@nitpicker/core`).
 *
 * The result is a judgement about the stored string read as markup with
 * balanced tags (the interpretation rules are in `@nitpicker/cli`'s
 * `docs/query.md`), not a DOM query. Tag and attribute names ignore ASCII
 * case only.
 * @param options - The plan and the document.
 * @param options.plan - The validated selector list.
 * @param options.html - The stored markup, as a string or as UTF-8 bytes.
 * @returns The verdict, which stages ran, and how many elements the stack tested.
 * @throws {Error} With code `InvalidArg` if the plan is malformed.
 * @example
 * ```ts
 * const { matched } = matchSelectorHtml({ plan, html: '<p><img src="a.png"></p>' });
 * ```
 */
export function matchSelectorHtml(options: {
	readonly plan: SelectorPlan;
	readonly html: string | Uint8Array;
}): HtmlMatchOutcome {
	// Passing archive's types to core's wrapper, and taking its result as
	// archive's type, is the check that the two still mirror each other: a
	// drift in either direction fails to compile here.
	const outcome: HtmlMatchOutcome = matchSelectorHtmlNatively(options);
	return outcome;
}
