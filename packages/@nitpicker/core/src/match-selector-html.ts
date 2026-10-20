import type { HtmlMatchOutcome, SelectorPlan } from './types.js';

import { nativeBinding } from './native-binding.js';
import { toNativeSelectorPlan } from './to-native-selector-plan.js';

/**
 * Decides whether any element of one stored HTML document matches a planned
 * selector list, using the cheapest stage that is exact: an ordered-literal
 * prefilter, then the start tags alone for selectors one tag decides, then
 * an open-element stack.
 *
 * The result is a judgement about the stored string read as markup with
 * balanced tags (the interpretation rules are in `@nitpicker/cli`'s
 * `docs/query.md`), not a DOM query: serialization is not injective, so it
 * is not guaranteed to equal the verdict on the DOM the string came from.
 * Tag and attribute names ignore ASCII case only.
 * @param options - The plan and the document.
 * @param options.plan - The validated selector list.
 * @param options.html - The stored markup, as a string or as UTF-8 bytes.
 * @returns The verdict, which stages ran, and how many elements the stack tested.
 * @throws {Error} With code `InvalidArg` if the plan is malformed.
 * @example
 * ```ts
 * const { matched } = matchSelectorHtml({
 * 	plan: {
 * 		alternatives: [
 * 			{
 * 				compounds: [{ tag: 'img', attributes: [], nth: [], negations: [] }],
 * 				combinators: [],
 * 				prefilterLiterals: ['<img'],
 * 				direct: true,
 * 			},
 * 		],
 * 		needsChildIndex: false,
 * 		needsTypeIndex: false,
 * 	},
 * 	html: '<p><img src="a.png"></p>',
 * });
 * matched; // true
 * ```
 */
export function matchSelectorHtml(options: {
	readonly plan: SelectorPlan;
	readonly html: string | Uint8Array;
}): HtmlMatchOutcome {
	const { plan, html } = options;
	return nativeBinding.matchSelectorHtml(
		toNativeSelectorPlan(plan),
		typeof html === 'string' ? Buffer.from(html, 'utf8') : html,
	);
}
